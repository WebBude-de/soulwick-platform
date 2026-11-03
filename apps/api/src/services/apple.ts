import { createHash, type JsonWebKey } from "node:crypto";
import { APPLE_NONCE_TTL_SECONDS } from "@soulwick/contracts";
import type { Config } from "../config.ts";
import { ApiError, withCause } from "../lib/errors.ts";
import {
  type DecodedJwt,
  decodeJwt,
  hasValidClaims,
  signEs256,
  verifyRs256,
} from "../lib/jwt.ts";
import { createLogger, type Logger } from "../lib/logger.ts";
import {
  decryptSecret,
  encryptSecret,
  hashSecret,
  hmacSecret,
  randomToken,
} from "../lib/secrets.ts";
import { forEachSequential } from "../lib/sequential.ts";
import type { BaseDeps } from "../types.ts";
import type { Db, DbOrTx } from "./db-types.ts";
import { putVerification, takeVerification } from "./verifications.ts";

/**
 * Sign in with Apple (D-188 (2), KF5, P-039): the client secret (an ES256 JWT signed with the
 * team's .p8 key), identity token checks against Apple's keys, the code exchange that yields the
 * refresh token, and the revocation of that token when the account is deleted or the Apple login
 * is unlinked (App Store rule 5.1.1(v)). Apple is asked with `deps.fetch` (tests inject a fake).
 */

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

/** TESTWERT: Apple's signing keys are cached this long; an unknown `kid` reloads earlier. */
const KEYS_CACHE_MS = 3_600_000;
/** An unknown `kid` reloads the keys at most this often. */
const KEYS_RELOAD_COOLDOWN_MS = 60_000;
/** Lifetime of the client secret JWT (Apple allows up to six months; we sign per use). */
const CLIENT_SECRET_TTL_SECONDS = 300;
/** TESTWERT: revocation attempts before a token is given up (then logged). */
const MAX_REVOCATION_ATTEMPTS = 8;
const REVOCATION_BATCH = 50;

type AppleConfig = Pick<
  Config,
  | "APPLE_CLIENT_ID"
  | "APPLE_APP_BUNDLE_ID"
  | "APPLE_TEAM_ID"
  | "APPLE_KEY_ID"
  | "APPLE_PRIVATE_KEY"
>;

/** Web flow (Services ID + key). */
export const isAppleWebConfigured = (c: AppleConfig) =>
  Boolean(c.APPLE_CLIENT_ID && c.APPLE_PRIVATE_KEY);

/** iOS app (bundle id); the key is optional (without it no refresh token, nothing to revoke). */
export const isAppleNativeConfigured = (c: AppleConfig) =>
  Boolean(c.APPLE_APP_BUNDLE_ID);

const hasAppleKey = (c: AppleConfig) => Boolean(c.APPLE_PRIVATE_KEY);

/** Client secret for `clientId` (Services ID or bundle id), see Apple's "Creating a client secret". */
export function appleClientSecret(
  config: AppleConfig,
  clientId: string,
  now: Date
): string {
  const iat = Math.floor(now.getTime() / 1000);
  return signEs256(
    {
      iss: config.APPLE_TEAM_ID,
      iat,
      exp: iat + CLIENT_SECRET_TTL_SECONDS,
      aud: APPLE_ISSUER,
      sub: clientId,
    },
    { kid: config.APPLE_KEY_ID, privateKeyPem: config.APPLE_PRIVATE_KEY }
  );
}

const unavailable = (cause: unknown) =>
  withCause(
    new ApiError(502, "apple_unavailable", "Apple could not be reached"),
    cause
  );
const invalidToken = (why: string) =>
  withCause(
    new ApiError(401, "invalid_apple_token", "Apple did not confirm the login"),
    new Error(why)
  );

interface JwkWithKid extends JsonWebKey {
  kid?: string;
}

/** Apple's public keys with a cache per app instance (`createAppleKeys` in the routes). */
export function createAppleKeys(deps: Pick<BaseDeps, "fetch">) {
  let keys: JwkWithKid[] = [];
  let loadedAt = 0;

  async function load(): Promise<void> {
    const doFetch = deps.fetch ?? fetch;
    let body: { keys?: JwkWithKid[] } | null;
    try {
      const res = await doFetch(APPLE_KEYS_URL, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`Apple keys HTTP ${res.status}`);
      }
      body = (await res.json()) as { keys?: JwkWithKid[] } | null;
    } catch (err) {
      throw unavailable(err);
    }
    if (!Array.isArray(body?.keys)) {
      throw unavailable(new Error("Apple keys without `keys`"));
    }
    keys = body.keys;
    loadedAt = Date.now();
  }

  return {
    async key(kid: string | undefined): Promise<JwkWithKid | null> {
      const age = Date.now() - loadedAt;
      const known = keys.find((k) => k.kid === kid);
      if (age > KEYS_CACHE_MS || (!known && age > KEYS_RELOAD_COOLDOWN_MS)) {
        await load();
        return keys.find((k) => k.kid === kid) ?? null;
      }
      return known ?? null;
    },
  };
}
export type AppleKeys = ReturnType<typeof createAppleKeys>;

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Verifies an identity token of Sign in with Apple: RS256 signature with Apple's key (`kid`),
 * issuer, audience (`audiences`), expiry; a given `nonce` must match the token's nonce as is or
 * as SHA-256 hex (apps usually send the hash to Apple). Returns the stable user id `sub`.
 */
export async function verifyAppleIdentityToken(
  keys: AppleKeys,
  token: string,
  expected: { audiences: string[]; nonce?: string; now: Date }
): Promise<string> {
  const jwt: DecodedJwt | null = decodeJwt(token);
  if (!jwt) {
    throw invalidToken("not a JWT");
  }
  const key = await keys.key(jwt.header.kid);
  if (!(key && verifyRs256(jwt, key))) {
    throw invalidToken("signature");
  }
  const claimsOk = hasValidClaims(jwt.payload, {
    issuers: [APPLE_ISSUER],
    audiences: expected.audiences,
    nowSeconds: Math.floor(expected.now.getTime() / 1000),
  });
  if (!claimsOk) {
    throw invalidToken("claims");
  }
  if (expected.nonce !== undefined) {
    const nonce = jwt.payload.nonce;
    if (nonce !== expected.nonce && nonce !== sha256Hex(expected.nonce)) {
      throw invalidToken("nonce");
    }
  }
  const sub = jwt.payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw invalidToken("sub");
  }
  return sub;
}

export interface AppleTokens {
  /** Claims of the id token from the token endpoint (direct TLS answer, OIDC 3.1.3.7). */
  idToken: Record<string, unknown>;
  refreshToken: string | null;
}

/**
 * Exchanges an authorization code at Apple's token endpoint. `redirectUri` only for the web flow.
 * Code rejected: 401 `invalid_apple_token`; Apple down or garbage: 502 `apple_unavailable`.
 */
export async function exchangeAppleCode(
  deps: Pick<BaseDeps, "fetch" | "config">,
  input: { code: string; clientId: string; redirectUri?: string; now: Date }
): Promise<AppleTokens> {
  const doFetch = deps.fetch ?? fetch;
  const form = new URLSearchParams({
    client_id: input.clientId,
    client_secret: appleClientSecret(deps.config, input.clientId, input.now),
    code: input.code,
    grant_type: "authorization_code",
  });
  if (input.redirectUri) {
    form.set("redirect_uri", input.redirectUri);
  }
  let res: Response;
  try {
    res = await doFetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(deps.config.EXTERNAL_AUTH_TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable(err);
  }
  if (res.status === 400 || res.status === 401) {
    throw invalidToken(`token endpoint HTTP ${res.status}`);
  }
  let body: { id_token?: unknown; refresh_token?: unknown } | null;
  try {
    if (!res.ok) {
      throw new Error(`token endpoint HTTP ${res.status}`);
    }
    body = (await res.json()) as typeof body;
  } catch (err) {
    throw unavailable(err);
  }
  const idToken =
    typeof body?.id_token === "string" ? decodeJwt(body.id_token) : null;
  if (!idToken) {
    throw unavailable(new Error("token endpoint answered without id_token"));
  }
  return {
    idToken: idToken.payload,
    refreshToken:
      typeof body?.refresh_token === "string" ? body.refresh_token : null,
  };
}

const appleNonceIdentifier = (
  config: Pick<Config, "BETTER_AUTH_SECRET">,
  nonce: string
) => `apple-nonce:${hashSecret(hmacSecret(config), "apple-nonce", nonce)}`;

/**
 * POST /auth/apple/nonce: a one-time nonce (APPLE_NONCE_TTL_SECONDS), stored only as HMAC. The
 * app puts SHA-256(nonce) into its Apple request; POST /auth/apple accepts each nonce once.
 */
export async function issueAppleNonce(
  db: Db,
  config: Pick<Config, "BETTER_AUTH_SECRET">,
  now: Date
): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = randomToken();
  const expiresAt = new Date(now.getTime() + APPLE_NONCE_TTL_SECONDS * 1000);
  await putVerification(db, {
    identifier: appleNonceIdentifier(config, nonce),
    value: { issuedAt: now.toISOString() },
    expiresAt,
  });
  return { nonce, expiresAt };
}

/** What the identity's Better Auth row keeps of an Apple login (refresh token encrypted). */
export interface AppleAccountData {
  clientId: string;
  refreshToken: string | null;
}

/**
 * POST /auth/apple and the Apple proof of POST /me/logins: verifies the identity token of the iOS
 * app and, with the team key configured, exchanges the authorization code for a refresh token
 * (soft: a failed exchange only means there is nothing to revoke later). Returns `sub`.
 */
export async function verifyAppleNative(
  deps: Pick<BaseDeps, "fetch" | "config" | "db">,
  keys: AppleKeys,
  input: {
    identityToken: string;
    authorizationCode?: string;
    /** Raw nonce from POST /auth/apple/nonce; used up here. */
    nonce: string;
    now: Date;
  },
  logger: Logger
): Promise<{ sub: string; account: AppleAccountData }> {
  const { config } = deps;
  if (!isAppleNativeConfigured(config)) {
    throw new ApiError(
      501,
      "provider_not_configured",
      "Login via apple is not configured on this server"
    );
  }
  // The nonce must be one this server issued and not used yet (replay protection, KF5 fix).
  const issued = await takeVerification(
    deps.db,
    appleNonceIdentifier(config, input.nonce),
    input.now
  );
  if (!issued) {
    throw invalidToken("nonce unknown or used");
  }
  const sub = await verifyAppleIdentityToken(keys, input.identityToken, {
    audiences: [config.APPLE_APP_BUNDLE_ID],
    nonce: input.nonce,
    now: input.now,
  });
  let refreshToken: string | null = null;
  if (input.authorizationCode && hasAppleKey(config)) {
    try {
      const tokens = await exchangeAppleCode(deps, {
        code: input.authorizationCode,
        clientId: config.APPLE_APP_BUNDLE_ID,
        now: input.now,
      });
      if (tokens.idToken.sub === sub) {
        refreshToken = tokens.refreshToken;
      }
    } catch (err) {
      logger.warn("apple_code_exchange_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    sub,
    account: {
      clientId: config.APPLE_APP_BUNDLE_ID,
      refreshToken: refreshToken ? encryptSecret(config, refreshToken) : null,
    },
  };
}

// --- revocation (P-039) --------------------------------------------------------------------------

/**
 * Queues the Apple refresh tokens of these Better Auth rows for revocation, in the transaction
 * that deletes the rows (account deletion, unlinking Apple). `sendRevocations` sends them.
 */
export async function queueAppleRevocations(
  tx: DbOrTx,
  where: { userId?: string; ids?: string[] }
): Promise<number> {
  const rows = await tx.account.findMany({
    where: {
      providerId: "apple",
      refreshToken: { not: null },
      clientId: { not: null },
      ...(where.userId ? { userId: where.userId } : {}),
      ...(where.ids ? { id: { in: where.ids } } : {}),
    },
    select: { refreshToken: true, clientId: true },
  });
  const data = rows.flatMap((r) =>
    r.refreshToken && r.clientId
      ? [
          {
            provider: "apple",
            clientId: r.clientId,
            token: r.refreshToken,
            tokenType: "refresh_token",
          },
        ]
      : []
  );
  if (data.length > 0) {
    await tx.oAuthTokenRevocation.createMany({ data });
  }
  return data.length;
}

/** Back-off after a failed attempt: 1 min, 4 min, 16 min, ... at most a day. */
const backoffMs = (attempts: number) =>
  Math.min(86_400_000, 60_000 * 4 ** Math.max(0, attempts - 1));

/**
 * Starts `sendRevocations` without waiting (after a deletion or unlinking): the answer to the
 * player does not wait for Apple; whatever fails is retried by the housekeeping.
 */
export function sendRevocationsSoon(deps: {
  db: Db;
  config: Config;
  fetch?: typeof fetch;
  now?: () => Date;
}): void {
  const logger = createLogger(deps.config.LOG_LEVEL);
  sendRevocations({ ...deps, logger }).catch((err: unknown) => {
    logger.warn("token_revocations_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Sends the queued revocations that are due. Success (and tokens Apple no longer knows, HTTP 400)
 * delete the row; failures retry with back-off, after MAX_REVOCATION_ATTEMPTS the row is given up.
 * Database errors are thrown (the callers log them); provider errors are retried later.
 */
export async function sendRevocations(deps: {
  db: Db;
  config: Config;
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => Date;
}): Promise<{ revoked: number; failed: number }> {
  const now = deps.now?.() ?? new Date();
  const doFetch = deps.fetch ?? fetch;
  const due = await deps.db.oAuthTokenRevocation.findMany({
    where: { nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: REVOCATION_BATCH,
  });
  let revoked = 0;
  let failed = 0;
  // One after the other on purpose: a handful of rows, and Apple should not see bursts.
  await forEachSequential(due, async (row) => {
    if (await revokeOne(deps, doFetch, row, now)) {
      revoked += 1;
      await deps.db.oAuthTokenRevocation.deleteMany({ where: { id: row.id } });
      return;
    }
    failed += 1;
    const attempts = row.attempts + 1;
    if (attempts >= MAX_REVOCATION_ATTEMPTS) {
      deps.logger.error("token_revocation_given_up", {
        provider: row.provider,
        attempts,
      });
      await deps.db.oAuthTokenRevocation.deleteMany({ where: { id: row.id } });
      return;
    }
    await deps.db.oAuthTokenRevocation.updateMany({
      where: { id: row.id },
      data: {
        attempts,
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
      },
    });
  });
  if (revoked > 0 || failed > 0) {
    deps.logger.info("token_revocations", { revoked, failed });
  }
  return { revoked, failed };
}

async function revokeOne(
  deps: { config: Config; logger: Logger },
  doFetch: typeof fetch,
  row: { provider: string; clientId: string; token: string; tokenType: string },
  now: Date
): Promise<boolean> {
  const token = decryptSecret(deps.config, row.token);
  if (row.provider !== "apple" || token === null || !hasAppleKey(deps.config)) {
    // Unknown provider, a rotated secret or a removed key: nothing can be sent, drop the row.
    deps.logger.warn("token_revocation_skipped", { provider: row.provider });
    return true;
  }
  try {
    const res = await doFetch(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: row.clientId,
        client_secret: appleClientSecret(deps.config, row.clientId, now),
        token,
        token_type_hint: row.tokenType,
      }),
      signal: AbortSignal.timeout(deps.config.EXTERNAL_AUTH_TIMEOUT_MS),
    });
    if (res.ok) {
      return true;
    }
    // `invalid_grant`: Apple does not know the token (any more), nothing left to revoke. Other
    // errors (e.g. `invalid_client` after a key change) are retried and logged.
    const body = (await res.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (res.status === 400 && body?.error === "invalid_grant") {
      return true;
    }
    deps.logger.warn("token_revocation_failed", {
      provider: row.provider,
      status: res.status,
      error: typeof body?.error === "string" ? body.error : undefined,
    });
    return false;
  } catch (err) {
    deps.logger.warn("token_revocation_failed", {
      provider: row.provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
