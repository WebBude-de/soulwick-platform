import { randomInt, timingSafeEqual } from "node:crypto";
import {
  LINK_CODE_ALPHABET,
  levelForXp,
  MAGIC_LINK_TTL_SECONDS,
  type MailLocale,
  WEB_LOGIN_CODE_LENGTH,
  WEB_LOGIN_TTL_SECONDS,
  type WebLoginInfo,
  type WebLoginIntent,
  type WebLoginMerge,
  type WebLoginProvider,
  type WebLoginStatus,
} from "@soulwick/contracts";
import { type Player, Prisma, type WebLoginRequest } from "@soulwick/db";
import { ApiError, isUniqueViolation } from "../lib/errors.ts";
import { hashSecret, randomToken } from "../lib/secrets.ts";
import { iso } from "../lib/validate.ts";
import { summarize } from "./account-link.ts";
import { findActiveBan } from "./bans.ts";
import type { Db, Tx } from "./db-types.ts";
import {
  addLoginInTx,
  findLoginOwner,
  findOrCreatePlayerInTx,
  type VerifiedLogin,
} from "./logins.ts";

/**
 * Web login from the game (P-036 (3), P-039): the game starts a request (`code` for the browser,
 * `pollSecret` only for itself), the player proves a login in the browser (OAuth, Steam OpenID,
 * magic link) and the game collects its session by polling. Codes and secrets are stored only as
 * HMACs; OAuth state and magic link tokens live in Better Auth's `auth_verifications` and are
 * used up atomically. A merge of two accounts with progress waits for a confirmation from the
 * browser that proved the login (the game alone cannot confirm it: phishing protection).
 */

const PURPOSE = {
  code: "web-login-code",
  poll: "web-login-poll",
  confirm: "web-login-confirm",
  magicLink: "magic-link",
  oauthState: "oauth-state",
  binding: "oauth-binding",
} as const;
/** Prefixes of our rows in auth_verifications (swept by the housekeeping when expired). */
export const VERIFICATION_PREFIXES = ["oauth-state:", "magic-link:"] as const;
const CODE_ATTEMPTS = 5;
/** After the browser finished, the game gets at least this long to collect the session. */
const COLLECT_GRACE_MS = 120_000;
const TX_TIMEOUT_MS = 15_000;

const hash = (secret: string, purpose: string, value: string) =>
  hashSecret(secret, purpose, value);

function sameHash(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function generateWebLoginCode(): string {
  let code = "";
  for (let i = 0; i < WEB_LOGIN_CODE_LENGTH; i += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

/** "ABCD-EFGH": how the game, the page and the mail show a code. */
export const formatWebLoginCode = (code: string) =>
  `${code.slice(0, 4)}-${code.slice(4)}`;

/** POST /auth/web-login: a new request; `playerId` for intent `link`. */
export async function createWebLogin(
  db: Db,
  input: {
    intent: WebLoginIntent;
    playerId: string | null;
    locale: MailLocale;
    secret: string;
    now: Date;
  }
): Promise<{ code: string; pollSecret: string; expiresAt: Date }> {
  const { intent, playerId, locale, secret, now } = input;
  const expiresAt = new Date(now.getTime() + WEB_LOGIN_TTL_SECONDS * 1000);
  const pollSecret = randomToken();
  // Retries one after the other on purpose: each attempt depends on the previous one failing.
  const attempt = async (
    left: number
  ): Promise<{ code: string; pollSecret: string; expiresAt: Date }> => {
    const code = generateWebLoginCode();
    try {
      await db.webLoginRequest.create({
        data: {
          codeHash: hash(secret, PURPOSE.code, code),
          pollSecretHash: hash(secret, PURPOSE.poll, pollSecret),
          intent,
          playerId,
          locale,
          createdAt: now,
          expiresAt,
        },
      });
      return { code, pollSecret, expiresAt };
    } catch (err) {
      if (!isUniqueViolation(err) || left <= 1) {
        throw err;
      }
      return await attempt(left - 1);
    }
  };
  return await attempt(CODE_ATTEMPTS);
}

export function findWebLogin(
  db: Db | Tx,
  code: string,
  secret: string
): Promise<WebLoginRequest | null> {
  return db.webLoginRequest.findUnique({
    where: { codeHash: hash(secret, PURPOSE.code, code) },
  });
}

export const isOpen = (row: WebLoginRequest, now: Date) =>
  row.status === "pending" && row.expiresAt > now;

/** The state the game and the page see. */
export function publicStatus(row: WebLoginRequest, now: Date): WebLoginStatus {
  if (row.status === "collected" || row.expiresAt <= now) {
    return "expired";
  }
  return row.status;
}

const resultOf = (row: WebLoginRequest) =>
  row.intent === "link" ? ("linked" as const) : ("signed_in" as const);

/** Remaining and removed account of a merge waiting for confirmation (oldest stays, D-122). */
async function mergePreview(
  db: Db,
  row: WebLoginRequest,
  now: Date
): Promise<WebLoginMerge | null> {
  const login = row.pendingLogin as unknown as VerifiedLogin | null;
  if (!(login && row.playerId)) {
    return null;
  }
  const identity = await findLoginOwner(db, login).catch(() => null);
  const caller = await db.player.findUnique({ where: { id: row.playerId } });
  const owner = identity
    ? await db.player.findUnique({ where: { id: identity.playerId } })
    : null;
  if (!(caller && owner) || caller.id === owner.id) {
    return null;
  }
  const ownerIsOlder = owner.createdAt.getTime() <= caller.createdAt.getTime();
  const remaining = ownerIsOlder ? owner : caller;
  const removed = ownerIsOlder ? caller : owner;
  return {
    remaining: (await summarize(db, remaining, now)).summary,
    removed: (await summarize(db, removed, now)).summary,
  };
}

/**
 * GET /auth/web-login/:code: what the website page shows. `merge` only with the matching confirm
 * secret while the request waits for the merge confirmation.
 */
export async function webLoginInfo(
  db: Db,
  row: WebLoginRequest,
  input: {
    code: string;
    confirmSecret?: string;
    methods: WebLoginInfo["methods"];
    secret: string;
    now: Date;
  }
): Promise<WebLoginInfo> {
  const { code, confirmSecret, methods, secret, now } = input;
  const status = publicStatus(row, now);
  const target: Player | null = row.playerId
    ? await db.player.findUnique({ where: { id: row.playerId } })
    : null;
  const confirmed =
    status === "confirm_merge" &&
    confirmSecret !== undefined &&
    sameHash(
      row.confirmSecretHash,
      hash(secret, PURPOSE.confirm, confirmSecret)
    );
  const done = status === "completed" || row.status === "collected";
  return {
    code,
    intent: row.intent,
    status,
    expiresAt: iso(row.expiresAt),
    account: target
      ? { name: target.name, level: levelForXp(target.xp) }
      : null,
    methods,
    provider: row.provider,
    result: done ? resultOf(row) : null,
    merged: row.merged,
    error: row.error,
    merge: confirmed ? await mergePreview(db, row, now) : null,
  };
}

// --- OAuth state and magic links (auth_verifications) --------------------------------------------

/**
 * Takes a value out of auth_verifications atomically (delete ... returning): two parallel uses
 * of the same state or link cannot both get it. Expired values count as missing.
 */
async function takeVerification(
  db: Db,
  identifier: string,
  now: Date
): Promise<unknown> {
  const rows = await db.$queryRaw<{ value: string; expires_at: Date }[]>`
    delete from auth_verifications where identifier = ${identifier}
    returning value, expires_at`;
  const row = rows[0];
  if (!row || row.expires_at <= now) {
    return null;
  }
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
}

interface OAuthState {
  /** HMAC of the binding cookie set at the start (login CSRF protection). */
  binding: string;
  /** Plain code, to send the browser back to `/login/<code>`. */
  code: string;
  codeVerifier: string | null;
  provider: WebLoginProvider;
  requestId: string;
}

/** Stores the state of a browser flow (lives as long as the request, at most). */
export async function createOAuthState(
  db: Db,
  input: {
    row: WebLoginRequest;
    code: string;
    provider: WebLoginProvider;
    codeVerifier: string | null;
    binding: string;
    secret: string;
  }
): Promise<string> {
  const state = randomToken();
  const value: OAuthState = {
    requestId: input.row.id,
    code: input.code,
    provider: input.provider,
    codeVerifier: input.codeVerifier,
    binding: hash(input.secret, PURPOSE.binding, input.binding),
  };
  await db.verification.create({
    data: {
      identifier: `oauth-state:${hash(input.secret, PURPOSE.oauthState, state)}`,
      value: JSON.stringify(value),
      expiresAt: input.row.expiresAt,
    },
  });
  return state;
}

/**
 * Uses up the state of a callback. Null: unknown, used, expired, other provider, or the browser
 * lacks the binding cookie of the start.
 */
export async function takeOAuthState(
  db: Db,
  input: {
    state: string;
    provider: WebLoginProvider;
    binding: string | undefined;
    secret: string;
    now: Date;
  }
): Promise<OAuthState | null> {
  const value = (await takeVerification(
    db,
    `oauth-state:${hash(input.secret, PURPOSE.oauthState, input.state)}`,
    input.now
  )) as OAuthState | null;
  if (!value || value.provider !== input.provider) {
    return null;
  }
  const bound =
    input.binding !== undefined &&
    sameHash(value.binding, hash(input.secret, PURPOSE.binding, input.binding));
  return bound ? value : null;
}

interface MagicLinkValue {
  code: string;
  email: string;
  requestId: string;
}

const magicIdentifier = (secret: string, token: string) =>
  `magic-link:${hash(secret, PURPOSE.magicLink, token)}`;

/**
 * A magic link token for `email`, bound to the request (MAGIC_LINK_TTL_SECONDS, once); the
 * request is extended to the link's expiry.
 */
export async function createMagicLink(
  db: Db,
  input: {
    row: WebLoginRequest;
    code: string;
    email: string;
    secret: string;
    now: Date;
  }
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(
    input.now.getTime() + MAGIC_LINK_TTL_SECONDS * 1000
  );
  const value: MagicLinkValue = {
    requestId: input.row.id,
    code: input.code,
    email: input.email,
  };
  await db.verification.create({
    data: {
      identifier: magicIdentifier(input.secret, token),
      value: JSON.stringify(value),
      expiresAt,
    },
  });
  // The request lives as long as its newest link, so the mail's "15 minutes" hold.
  if (input.row.expiresAt < expiresAt) {
    await db.webLoginRequest.updateMany({
      where: { id: input.row.id, status: "pending" },
      data: { expiresAt },
    });
  }
  return { token, expiresAt };
}

/** The magic link without using it up (preview page), or null. */
export async function peekMagicLink(
  db: Db,
  token: string,
  secret: string,
  now: Date
): Promise<(MagicLinkValue & { expiresAt: Date }) | null> {
  const row = await db.verification.findFirst({
    where: {
      identifier: magicIdentifier(secret, token),
      expiresAt: { gt: now },
    },
  });
  if (!row) {
    return null;
  }
  try {
    return {
      ...(JSON.parse(row.value) as MagicLinkValue),
      expiresAt: row.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Uses the magic link up; null if unknown, used or expired. */
export async function takeMagicLink(
  db: Db,
  token: string,
  secret: string,
  now: Date
): Promise<MagicLinkValue | null> {
  return (await takeVerification(
    db,
    magicIdentifier(secret, token),
    now
  )) as MagicLinkValue | null;
}

// --- finishing in the browser --------------------------------------------------------------------

export interface WebLoginOutcome {
  /** Only for `confirm_merge`: the secret the browser needs to confirm. */
  confirmSecret?: string;
  status: "completed" | "confirm_merge" | "failed";
}

/** Stable codes a failed request keeps (the rest are thrown). */
const FAILING_CODES = new Set([
  "merge_blocked_banned",
  "account_gone",
  "email_unavailable",
]);

const notPending = () =>
  new ApiError(
    409,
    "web_login_not_pending",
    "This login request is finished or expired; start again in the game"
  );

async function lockRequest(tx: Tx, requestId: string) {
  await tx.$queryRaw`select id from web_login_requests where id = ${requestId}::uuid for update`;
  return await tx.webLoginRequest.findUnique({ where: { id: requestId } });
}

const graceExpiry = (row: WebLoginRequest, now: Date) =>
  new Date(Math.max(row.expiresAt.getTime(), now.getTime() + COLLECT_GRACE_MS));

/**
 * The browser proved `login` for the request. `sign_in`: the account behind it (created if new;
 * banned → failed `banned`). `link`: the login goes to the request's account (`addLoginInTx`);
 * both accounts with progress → `confirm_merge` with a confirm secret. 409 `web_login_not_pending`
 * if the request is not open any more.
 */
export async function completeWebLogin(
  db: Db,
  input: { requestId: string; login: VerifiedLogin; secret: string; now: Date }
): Promise<WebLoginOutcome> {
  const { requestId, login, secret, now } = input;
  const run = () =>
    db.$transaction(
      async (tx): Promise<WebLoginOutcome> => {
        const row = await lockRequest(tx, requestId);
        if (!(row && isOpen(row, now))) {
          throw notPending();
        }
        const done = (data: Prisma.WebLoginRequestUpdateInput) =>
          tx.webLoginRequest.update({
            where: { id: row.id },
            data: {
              provider: login.provider,
              completedAt: now,
              expiresAt: graceExpiry(row, now),
              ...data,
            },
          });
        try {
          if (row.intent === "sign_in") {
            const { player } = await findOrCreatePlayerInTx(tx, login, now);
            const banned = await findActiveBan(tx, player.id, now);
            await done({
              status: banned ? "failed" : "completed",
              error: banned ? "banned" : null,
              resultPlayer: { connect: { id: player.id } },
            });
            return { status: banned ? "failed" : "completed" };
          }
          if (!row.playerId) {
            throw new ApiError(404, "account_gone", "The account is gone");
          }
          const result = await addLoginInTx(tx, {
            playerId: row.playerId,
            login,
            confirmMerge: false,
            now,
          });
          await done({
            status: "completed",
            resultPlayer: { connect: { id: result.remaining.id } },
            removedPlayerId: result.removedPlayerId,
            merged: result.merged,
          });
          return { status: "completed" };
        } catch (err) {
          if (!(err instanceof ApiError)) {
            throw err;
          }
          if (err.code === "account_has_progress") {
            // Thrown before anything was written: park the login until the browser confirms.
            const confirmSecret = randomToken();
            await done({
              status: "confirm_merge",
              confirmSecretHash: hash(secret, PURPOSE.confirm, confirmSecret),
              pendingLogin: login as unknown as Prisma.InputJsonValue,
            });
            return { status: "confirm_merge", confirmSecret };
          }
          if (FAILING_CODES.has(err.code)) {
            await done({ status: "failed", error: err.code });
            return { status: "failed" };
          }
          throw err;
        }
      },
      { timeout: TX_TIMEOUT_MS }
    );
  try {
    return await run();
  } catch (err) {
    // Two first logins with the same new login at once: the loser runs again and finds it.
    if (isUniqueViolation(err)) {
      return await run();
    }
    throw err;
  }
}

/**
 * POST /auth/web-login/confirm-merge: the browser confirms the merge of both accounts; the
 * parked login is applied with `confirmMerge` (older account stays). 404 `web_login_not_found`
 * (unknown code or wrong secret), 409 `web_login_not_confirmable`.
 */
export async function confirmWebLoginMerge(
  db: Db,
  input: { code: string; confirmSecret: string; secret: string; now: Date }
): Promise<WebLoginRequest> {
  const { code, confirmSecret, secret, now } = input;
  const found = await findWebLogin(db, code, secret);
  if (
    !(
      found &&
      sameHash(
        found.confirmSecretHash,
        hash(secret, PURPOSE.confirm, confirmSecret)
      )
    )
  ) {
    throw new ApiError(404, "web_login_not_found", "Unknown login request");
  }
  return await db.$transaction(
    async (tx) => {
      const row = await lockRequest(tx, found.id);
      const login = row?.pendingLogin as unknown as VerifiedLogin | null;
      if (
        !(row && row.status === "confirm_merge" && row.expiresAt > now && login)
      ) {
        throw new ApiError(
          409,
          "web_login_not_confirmable",
          "This login request does not wait for a confirmation"
        );
      }
      const finish = (data: Prisma.WebLoginRequestUpdateInput) =>
        tx.webLoginRequest.update({
          where: { id: row.id },
          data: {
            pendingLogin: Prisma.DbNull,
            confirmSecretHash: null,
            completedAt: now,
            expiresAt: graceExpiry(row, now),
            ...data,
          },
        });
      try {
        if (!row.playerId) {
          throw new ApiError(404, "account_gone", "The account is gone");
        }
        const result = await addLoginInTx(tx, {
          playerId: row.playerId,
          login,
          confirmMerge: true,
          now,
        });
        return await finish({
          status: "completed",
          resultPlayer: { connect: { id: result.remaining.id } },
          removedPlayerId: result.removedPlayerId,
          merged: result.merged,
        });
      } catch (err) {
        if (err instanceof ApiError && FAILING_CODES.has(err.code)) {
          return await finish({ status: "failed", error: err.code });
        }
        throw err;
      }
    },
    { timeout: TX_TIMEOUT_MS }
  );
}

// --- collecting in the game ----------------------------------------------------------------------

export type CollectResult =
  | { status: "pending" | "confirm_merge" | "expired" }
  | {
      status: "failed";
      error: string;
      reason?: string | null;
      banExpiresAt?: Date | null;
    }
  | {
      status: "completed";
      row: WebLoginRequest;
      player: Player;
    };

/**
 * POST /auth/web-login/poll: the state for the game; a completed request hands out its account
 * exactly once (the route creates the session). 404 `web_login_not_found` for an unknown code or
 * a wrong poll secret.
 */
export async function collectWebLogin(
  db: Db,
  input: { code: string; pollSecret: string; secret: string; now: Date }
): Promise<CollectResult> {
  const { code, pollSecret, secret, now } = input;
  const row = await findWebLogin(db, code, secret);
  if (
    !(
      row &&
      sameHash(row.pollSecretHash, hash(secret, PURPOSE.poll, pollSecret))
    )
  ) {
    throw new ApiError(404, "web_login_not_found", "Unknown login request");
  }
  const status = publicStatus(row, now);
  if (
    status === "pending" ||
    status === "confirm_merge" ||
    status === "expired"
  ) {
    return { status };
  }
  if (status === "failed") {
    const ban =
      row.error === "banned" && row.resultPlayerId
        ? await findActiveBan(db, row.resultPlayerId, now)
        : null;
    return {
      status: "failed",
      error: row.error ?? "failed",
      reason: ban?.reason ?? null,
      banExpiresAt: ban?.expiresAt ?? null,
    };
  }
  const { count } = await db.webLoginRequest.updateMany({
    where: { id: row.id, status: "completed" },
    data: { status: "collected" },
  });
  const player = row.resultPlayerId
    ? await db.player.findUnique({ where: { id: row.resultPlayerId } })
    : null;
  if (count === 0) {
    return { status: "expired" };
  }
  if (!player) {
    return { status: "failed", error: "account_gone" };
  }
  return { status: "completed", row, player };
}

/** Housekeeping: expired requests and our expired rows in auth_verifications. */
export async function deleteExpiredWebLogins(
  db: Db,
  now: Date
): Promise<number> {
  const requests = await db.webLoginRequest.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const verifications = await db.verification.deleteMany({
    where: {
      expiresAt: { lt: now },
      OR: VERIFICATION_PREFIXES.map((prefix) => ({
        identifier: { startsWith: prefix },
      })),
    },
  });
  return requests.count + verifications.count;
}
