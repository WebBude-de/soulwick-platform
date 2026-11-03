import { randomInt, timingSafeEqual } from "node:crypto";
import {
  LINK_CODE_ALPHABET,
  levelForXp,
  MAGIC_LINK_TTL_SECONDS,
  type MailLocale,
  WEB_LOGIN_CODE_LENGTH,
  WEB_LOGIN_CONFIRM_MAX_ATTEMPTS,
  WEB_LOGIN_TTL_SECONDS,
  WEB_LOGIN_USER_CODE_LENGTH,
  type WebLoginAccount,
  type WebLoginInfo,
  type WebLoginIntent,
  type WebLoginMerge,
  type WebLoginProvider,
  type WebLoginStatus,
  WebLoginUserCode,
} from "@soulwick/contracts";
import { type Player, Prisma, type WebLoginRequest } from "@soulwick/db";
import { ApiError, isUniqueViolation } from "../lib/errors.ts";
import { hashSecret, randomToken } from "../lib/secrets.ts";
import { iso, isoOrNull } from "../lib/validate.ts";
import { planMerge } from "./account-link.ts";
import { findActiveBan } from "./bans.ts";
import type { Db, Tx } from "./db-types.ts";
import {
  addLoginInTx,
  findLoginOwner,
  findOrCreatePlayerInTx,
  type VerifiedLogin,
} from "./logins.ts";
import {
  deleteExpiredVerifications,
  peekVerification,
  putVerification,
  takeVerification,
} from "./verifications.ts";

/**
 * Web login from the game (P-036 (3), P-039 with the security fix of 03.11.2026): the game
 * starts a request and gets four values: `code` (in the page URL), `browserSecret` (`#k=` in the
 * URL, needed to start a login in the browser), `userCode` (shown in the game, typed in the
 * browser to confirm) and `pollSecret` (only the game, to collect the session). Proving a login in
 * the browser (OAuth, Steam OpenID, magic link) finishes nothing: the request waits in
 * `awaiting_confirm` until the same browser confirms with its confirm secret and the typed code
 * (`confirmWebLogin`), which then signs in, adds the login, absorbs an empty account or merges two
 * with progress. Like the device-code confirmation of large platforms: a link someone else sent
 * cannot sign their game in to your account without you typing the code their game shows.
 * All codes and secrets are stored only as HMACs.
 */

const PURPOSE = {
  code: "web-login-code",
  userCode: "web-login-user-code",
  poll: "web-login-poll",
  browser: "web-login-browser",
  browserToken: "web-login-browser-token",
  confirm: "web-login-confirm",
  magicLink: "magic-link",
  oauthState: "oauth-state",
  binding: "oauth-binding",
} as const;
const CODE_ATTEMPTS = 5;
/** After a proof or completion the player gets at least this long for the next step. */
const STEP_GRACE_MS = 120_000;
/** Hard end of a request, however often it was extended. */
const MAX_LIFETIME_MS = 2 * WEB_LOGIN_TTL_SECONDS * 1000;
const TX_TIMEOUT_MS = 15_000;

const hash = (secret: string, purpose: string, value: string) =>
  hashSecret(secret, purpose, value);

function sameHash(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

export const generateWebLoginCode = () => randomCode(WEB_LOGIN_CODE_LENGTH);

/** "ABCD-EFGH" / "ABC-DEF": how codes are shown. */
export const formatCode = (code: string) => {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
};

export interface CreatedWebLogin {
  browserSecret: string;
  code: string;
  expiresAt: Date;
  pollSecret: string;
  userCode: string;
}

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
): Promise<CreatedWebLogin> {
  const { intent, playerId, locale, secret, now } = input;
  const expiresAt = new Date(now.getTime() + WEB_LOGIN_TTL_SECONDS * 1000);
  const pollSecret = randomToken();
  const browserSecret = randomToken();
  const userCode = randomCode(WEB_LOGIN_USER_CODE_LENGTH);
  // Retries one after the other on purpose: each attempt depends on the previous one failing.
  const attempt = async (left: number): Promise<CreatedWebLogin> => {
    const code = generateWebLoginCode();
    try {
      await db.webLoginRequest.create({
        data: {
          codeHash: hash(secret, PURPOSE.code, code),
          pollSecretHash: hash(secret, PURPOSE.poll, pollSecret),
          browserSecretHash: hash(secret, PURPOSE.browser, browserSecret),
          userCodeHash: hash(secret, PURPOSE.userCode, userCode),
          intent,
          playerId,
          locale,
          createdAt: now,
          expiresAt,
        },
      });
      return { code, pollSecret, browserSecret, userCode, expiresAt };
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

/** Whether `browserToken` is the token the request's `k` was traded for. */
export const hasBrowserToken = (
  row: WebLoginRequest,
  browserToken: string | undefined,
  secret: string
) =>
  browserToken !== undefined &&
  sameHash(
    row.browserTokenHash,
    hash(secret, PURPOSE.browserToken, browserToken)
  );

/**
 * POST /auth/web-login/claim: trades the browser secret `k` (URL fragment) once for a browser
 * token; afterwards `k` is worthless. 404 `web_login_not_found` (unknown code, wrong `k`), 409
 * `web_login_not_pending`, 409 `web_login_claimed`.
 */
export async function claimWebLogin(
  db: Db,
  input: { code: string; k: string; secret: string; now: Date }
): Promise<{ browserToken: string; expiresAt: Date }> {
  const { code, k, secret, now } = input;
  const row = await findWebLogin(db, code, secret);
  if (!(row && hasBrowserSecret(row, k, secret))) {
    throw new ApiError(404, "web_login_not_found", "Unknown login request");
  }
  if (!isOpen(row, now)) {
    throw notPending();
  }
  const browserToken = randomToken();
  // Atomic: of two parallel claims exactly one gets a token.
  const { count } = await db.webLoginRequest.updateMany({
    where: { id: row.id, browserClaimedAt: null },
    data: {
      browserClaimedAt: now,
      browserTokenHash: hash(secret, PURPOSE.browserToken, browserToken),
    },
  });
  if (count === 0) {
    throw new ApiError(
      409,
      "web_login_claimed",
      "This link was already used; start the login again in the game"
    );
  }
  return { browserToken, expiresAt: row.expiresAt };
}

/** Whether `browserSecret` is the request's `k`. */
export const hasBrowserSecret = (
  row: WebLoginRequest,
  browserSecret: string | undefined,
  secret: string
) =>
  browserSecret !== undefined &&
  sameHash(row.browserSecretHash, hash(secret, PURPOSE.browser, browserSecret));

/** Whether `confirmSecret` is the one handed to the browser that proved the login. */
export const hasConfirmSecret = (
  row: WebLoginRequest,
  confirmSecret: string | undefined,
  secret: string
) =>
  confirmSecret !== undefined &&
  sameHash(row.confirmSecretHash, hash(secret, PURPOSE.confirm, confirmSecret));

/** Open for a login in the browser (a new proof may replace one that waits for confirmation). */
export const isOpen = (row: WebLoginRequest, now: Date) =>
  (row.status === "pending" || row.status === "awaiting_confirm") &&
  row.expiresAt > now;

/** The state the game and the page see. */
export function publicStatus(row: WebLoginRequest, now: Date): WebLoginStatus {
  if (row.status === "collected" || row.expiresAt <= now) {
    return "expired";
  }
  // `confirm_merge` is no longer written (kept in the database enum only).
  return row.status === "confirm_merge" ? "awaiting_confirm" : row.status;
}

const resultOf = (row: WebLoginRequest) =>
  row.intent === "link" ? ("linked" as const) : ("signed_in" as const);

const accountOf = (p: Player): WebLoginAccount => ({
  name: p.name,
  level: levelForXp(p.xp),
});

/**
 * What confirming would do: the account the game ends up on and the accounts it joins. Reads only.
 */
async function confirmationPreview(
  db: Db,
  row: WebLoginRequest,
  now: Date
): Promise<{
  account: WebLoginAccount | null;
  newAccount: boolean;
  merge: WebLoginMerge | null;
}> {
  const login = row.pendingLogin as unknown as VerifiedLogin | null;
  if (!login) {
    return { account: null, newAccount: false, merge: null };
  }
  const identity = await findLoginOwner(db, login).catch(() => null);
  const owner = identity
    ? await db.player.findUnique({ where: { id: identity.playerId } })
    : null;
  if (row.intent === "sign_in") {
    return owner
      ? { account: accountOf(owner), newAccount: false, merge: null }
      : { account: null, newAccount: true, merge: null };
  }
  const target = row.playerId
    ? await db.player.findUnique({ where: { id: row.playerId } })
    : null;
  if (!target) {
    return { account: null, newAccount: false, merge: null };
  }
  if (!owner || owner.id === target.id) {
    return { account: accountOf(target), newAccount: false, merge: null };
  }
  const plan = await planMerge(db, owner, target, now);
  return {
    account: accountOf(plan.keep),
    newAccount: false,
    merge: {
      remaining: plan.keepSummary,
      removed: plan.dropSummary,
      bothHaveProgress: plan.bothHaveProgress,
    },
  };
}

/**
 * GET /auth/web-login/:code: what the website page shows. Without credentials only status and
 * expiry; with the browser token also intent, methods and the outcome; account data (`account`,
 * `newAccount`, `merge`, `ban`) only with the confirm secret of the browser that proved a login.
 */
export async function webLoginInfo(
  db: Db,
  row: WebLoginRequest,
  input: {
    code: string;
    browserToken?: string;
    confirmSecret?: string;
    methods: WebLoginInfo["methods"];
    secret: string;
    now: Date;
  }
): Promise<WebLoginInfo> {
  const { code, methods, secret, now } = input;
  const status = publicStatus(row, now);
  const base: WebLoginInfo = {
    code,
    status,
    expiresAt: iso(row.expiresAt),
    authorized: false,
    intent: null,
    account: null,
    newAccount: false,
    methods: [],
    provider: null,
    result: null,
    merged: false,
    error: null,
    merge: null,
    ban: null,
    attemptsLeft: null,
  };
  const prover = hasConfirmSecret(row, input.confirmSecret, secret);
  const authorized = prover || hasBrowserToken(row, input.browserToken, secret);
  if (!authorized) {
    return base;
  }
  let account: WebLoginAccount | null = null;
  let newAccount = false;
  let merge: WebLoginMerge | null = null;
  if (!prover) {
    // Browser token only: no account data (whoever saw the token must not learn whose login
    // was proven, nor whether it has an account).
  } else if (status === "awaiting_confirm") {
    ({ account, newAccount, merge } = await confirmationPreview(db, row, now));
  } else {
    const shown =
      row.resultPlayerId ?? (row.intent === "link" ? row.playerId : null);
    const player = shown
      ? await db.player.findUnique({ where: { id: shown } })
      : null;
    account = player ? accountOf(player) : null;
  }
  const ban =
    prover && row.error === "banned" && row.resultPlayerId
      ? await findActiveBan(db, row.resultPlayerId, now)
      : null;
  const done = status === "completed" || row.status === "collected";
  return {
    ...base,
    authorized: true,
    intent: row.intent,
    account,
    newAccount,
    methods:
      status === "pending" || status === "awaiting_confirm" ? methods : [],
    provider: row.provider,
    result: done ? resultOf(row) : null,
    merged: row.merged,
    error: row.error,
    merge,
    ban: ban
      ? { reason: ban.reason, expiresAt: isoOrNull(ban.expiresAt) }
      : null,
    attemptsLeft:
      status === "awaiting_confirm"
        ? Math.max(0, WEB_LOGIN_CONFIRM_MAX_ATTEMPTS - row.confirmAttempts)
        : null,
  };
}

// --- OAuth state and magic links (auth_verifications) --------------------------------------------

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
  await putVerification(db, {
    identifier: `oauth-state:${hash(input.secret, PURPOSE.oauthState, state)}`,
    value,
    expiresAt: input.row.expiresAt,
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
  // Never past the hard end of the request (MAX_LIFETIME_MS from its start).
  const expiresAt = new Date(
    Math.min(
      input.now.getTime() + MAGIC_LINK_TTL_SECONDS * 1000,
      input.row.createdAt.getTime() + MAX_LIFETIME_MS
    )
  );
  const value: MagicLinkValue = {
    requestId: input.row.id,
    code: input.code,
    email: input.email,
  };
  await putVerification(db, {
    identifier: magicIdentifier(input.secret, token),
    value,
    expiresAt,
  });
  // The request lives as long as its newest link, so the mail's "15 minutes" hold.
  if (input.row.expiresAt < expiresAt) {
    await db.webLoginRequest.updateMany({
      where: {
        id: input.row.id,
        status: { in: ["pending", "awaiting_confirm"] },
      },
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
  const found = await peekVerification(db, magicIdentifier(secret, token), now);
  return found
    ? { ...(found.value as MagicLinkValue), expiresAt: found.expiresAt }
    : null;
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

// --- proof and confirmation in the browser -------------------------------------------------------

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

/** Extends the request for the next step, never past MAX_LIFETIME_MS from its start. */
const stepExpiry = (row: WebLoginRequest, now: Date) =>
  new Date(
    Math.min(
      row.createdAt.getTime() + MAX_LIFETIME_MS,
      Math.max(row.expiresAt.getTime(), now.getTime() + STEP_GRACE_MS)
    )
  );

/**
 * The browser proved `login` for the request: it is parked until the same browser confirms
 * (`awaiting_confirm`). A new proof replaces a parked one (another provider tried); the wrong
 * attempts of the typed code are not reset. Returns the confirm secret for the browser.
 * 409 `web_login_not_pending` if the request is not open.
 */
export async function proveWebLogin(
  db: Db,
  input: { requestId: string; login: VerifiedLogin; secret: string; now: Date }
): Promise<{ confirmSecret: string }> {
  const { requestId, login, secret, now } = input;
  const confirmSecret = randomToken();
  await db.$transaction(
    async (tx) => {
      const row = await lockRequest(tx, requestId);
      if (!(row && isOpen(row, now))) {
        throw notPending();
      }
      await tx.webLoginRequest.update({
        where: { id: row.id },
        data: {
          status: "awaiting_confirm",
          provider: login.provider,
          pendingLogin: login as unknown as Prisma.InputJsonValue,
          confirmSecretHash: hash(secret, PURPOSE.confirm, confirmSecret),
          expiresAt: stepExpiry(row, now),
        },
      });
    },
    { timeout: TX_TIMEOUT_MS }
  );
  return { confirmSecret };
}

/** Stable codes a failed request keeps (the rest are thrown). */
const FAILING_CODES = new Set([
  "merge_blocked_banned",
  "account_gone",
  "email_unavailable",
]);

const notFound = () =>
  new ApiError(404, "web_login_not_found", "Unknown login request");
const notConfirmable = () =>
  new ApiError(
    409,
    "web_login_not_confirmable",
    "This login request does not wait for a confirmation"
  );

/**
 * Counts one confirmation attempt atomically BEFORE the code is compared: only while the request
 * waits, has attempts left and still carries this confirm secret. Returns the attempts used, or
 * null when the request cannot be confirmed (any more) with this secret.
 */
async function takeAttempt(
  db: Db,
  requestId: string,
  confirmSecretHash: string
): Promise<number | null> {
  const rows = await db.$queryRaw<{ confirm_attempts: number }[]>`
    update web_login_requests
    set confirm_attempts = confirm_attempts + 1
    where id = ${requestId}::uuid
      and status = 'awaiting_confirm'
      and confirm_attempts < ${WEB_LOGIN_CONFIRM_MAX_ATTEMPTS}
      and confirm_secret_hash = ${confirmSecretHash}
    returning confirm_attempts`;
  return rows[0]?.confirm_attempts ?? null;
}

/** All attempts used with a wrong code: the request fails (`too_many_attempts`). */
async function failExhausted(db: Db, requestId: string): Promise<void> {
  await db.webLoginRequest.updateMany({
    where: { id: requestId, status: "awaiting_confirm" },
    data: {
      status: "failed",
      error: "too_many_attempts",
      pendingLogin: Prisma.DbNull,
    },
  });
}

/**
 * POST /auth/web-login/confirm: the browser that proved the login confirms with the code the game
 * shows. Only now the parked login is applied: `sign_in` → the account behind it (created if new;
 * banned → failed `banned`); `link` → `addLoginInTx` with the merge confirmed (an empty account
 * is absorbed, two with progress merged; the page showed which). Errors: 404
 * `web_login_not_found` (unknown code, wrong confirm secret), 409 `web_login_not_confirmable`,
 * 400 `wrong_code` (`attemptsLeft`; at 0 the request is failed with `too_many_attempts`).
 */
export async function confirmWebLogin(
  db: Db,
  input: {
    code: string;
    confirmSecret: string;
    typedCode: string;
    secret: string;
    now: Date;
  }
): Promise<WebLoginRequest> {
  const { code, confirmSecret, typedCode, secret, now } = input;
  const found = await findWebLogin(db, code, secret);
  if (!(found && hasConfirmSecret(found, confirmSecret, secret))) {
    throw notFound();
  }
  if (publicStatus(found, now) !== "awaiting_confirm") {
    throw notConfirmable();
  }
  const confirmSecretHash = hash(secret, PURPOSE.confirm, confirmSecret);
  const attempts = await takeAttempt(db, found.id, confirmSecretHash);
  if (attempts === null) {
    throw notConfirmable();
  }
  const typed = WebLoginUserCode.safeParse(typedCode);
  const matches =
    typed.success &&
    sameHash(found.userCodeHash, hash(secret, PURPOSE.userCode, typed.data));
  if (!matches) {
    const attemptsLeft = Math.max(0, WEB_LOGIN_CONFIRM_MAX_ATTEMPTS - attempts);
    if (attemptsLeft === 0) {
      await failExhausted(db, found.id);
    }
    throw new ApiError(
      400,
      "wrong_code",
      "The code does not match the code shown in the game",
      { attemptsLeft }
    );
  }
  const run = () =>
    db.$transaction(
      async (tx) => {
        const row = await lockRequest(tx, found.id);
        const login = row?.pendingLogin as unknown as VerifiedLogin | null;
        // Checked again under the lock: a new proof between the read above and this
        // transaction replaces the parked login and its confirm secret (time-of-check race).
        if (
          !(
            row &&
            row.status === "awaiting_confirm" &&
            row.expiresAt > now &&
            login &&
            hasConfirmSecret(row, confirmSecret, secret)
          )
        ) {
          throw notConfirmable();
        }
        const finish = (data: Prisma.WebLoginRequestUpdateInput) =>
          tx.webLoginRequest.update({
            where: { id: row.id },
            data: {
              // The confirm secret stays valid for reading the result (status is final now).
              pendingLogin: Prisma.DbNull,
              completedAt: now,
              expiresAt: stepExpiry(row, now),
              ...data,
            },
          });
        try {
          if (row.intent === "sign_in") {
            const { player } = await findOrCreatePlayerInTx(tx, login, now);
            const banned = await findActiveBan(tx, player.id, now);
            return await finish({
              status: banned ? "failed" : "completed",
              error: banned ? "banned" : null,
              resultPlayer: { connect: { id: player.id } },
            });
          }
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

// --- collecting in the game ----------------------------------------------------------------------

export type CollectResult =
  | { status: "pending" | "awaiting_confirm" | "expired" }
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
    throw notFound();
  }
  const status = publicStatus(row, now);
  if (
    status === "pending" ||
    status === "awaiting_confirm" ||
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
  return requests.count + (await deleteExpiredVerifications(db, now));
}
