import { z } from "zod";
import {
  IsoDateTime,
  PlayerAppearance,
  PlayerLevel,
  PlayerName,
  Uuid,
} from "./common.ts";
import {
  AccountSummary,
  GameCenterAuthRequest,
  IdentityProvider,
  IdentitySummary,
  LINK_CODE_ALPHABET,
} from "./identity.ts";
import { AuthResponse, GuestDeviceId, SteamAuthRequest } from "./player.ts";

/**
 * Player logins of KF5 (D-188, P-036, P-037, P-039): username + password, magic link, the web
 * login from the game (OAuth with Google, Apple, Discord and Steam OpenID in the browser), Sign in
 * with Apple in the iOS app and "add login" with proof. Every login answers `AuthResponse` like
 * `/auth/device`; logins only ever attach to an account with proof, never through a matching
 * e-mail address.
 */

// --- username and password ----------------------------------------------------------------------

/** TESTWERT: minimum length of a player password (P-036). */
export const PLAYER_PASSWORD_MIN_LENGTH = 10;
export const PLAYER_PASSWORD_MAX_LENGTH = 128;

/**
 * Private username of the password login (never the display name, never shown to other players).
 * 3–24 characters `a-z 0-9 . _ -`, starting with a letter or digit; input is trimmed and lower-cased.
 */
export const PlayerUsername = z
  .string()
  .trim()
  .transform((s) => s.toLowerCase())
  .pipe(
    z
      .string()
      .min(3)
      .max(24)
      .regex(
        /^[a-z0-9][a-z0-9._-]*$/,
        "letters a-z, digits and . _ - only, starting with a letter or digit"
      )
  );
export type PlayerUsername = z.infer<typeof PlayerUsername>;

export const PlayerPassword = z
  .string()
  .min(PLAYER_PASSWORD_MIN_LENGTH)
  .max(PLAYER_PASSWORD_MAX_LENGTH);

/**
 * POST /auth/password -> `AuthResponse`. Unknown username and wrong password give the same
 * 401 `invalid_credentials`. Errors: 400 `validation_error`, 403 `banned`, 429 `rate_limited`
 * (attempts per IP and minute, or too many failures for this username; `Retry-After`).
 */
export const PasswordLoginRequest = z.object({
  /** Lower-cased by the server; a malformed name is simply a wrong login (401). */
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(PLAYER_PASSWORD_MAX_LENGTH),
});
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequest>;

/**
 * PUT /me/logins/password (player session) -> `IdentityList`. Adds the password login to the own
 * account (both fields needed) or changes username and/or password of the existing one. The
 * session is the proof; other sessions stay. Errors: 400 `validation_error`
 * (`username and password required` when there is none yet), 409 `username_taken`, 403 `banned`.
 */
export const SetPasswordLoginRequest = z
  .object({
    username: PlayerUsername.optional(),
    password: PlayerPassword.optional(),
  })
  .refine((v) => v.username !== undefined || v.password !== undefined, {
    message: "username or password required",
  });
export type SetPasswordLoginRequest = z.infer<typeof SetPasswordLoginRequest>;

// --- web login from the game (P-036 (3), P-039) -------------------------------------------------

/** Same alphabet as link codes (no 0/O, 1/I/L). */
export const WEB_LOGIN_CODE_LENGTH = 8;
/** TESTWERT: length of the code the game shows and the player types in the browser. */
export const WEB_LOGIN_USER_CODE_LENGTH = 6;
/** TESTWERT: wrong typed codes before the request fails (`too_many_attempts`). */
export const WEB_LOGIN_CONFIRM_MAX_ATTEMPTS = 5;
/** TESTWERT: lifetime of a web login request (codes and secrets). */
export const WEB_LOGIN_TTL_SECONDS = 600;
/** How often the game asks POST /auth/web-login/poll. */
export const WEB_LOGIN_POLL_INTERVAL_SECONDS = 2;
/** TESTWERT: lifetime of a magic link. */
export const MAGIC_LINK_TTL_SECONDS = 900;
export const WEB_LOGIN_CODE_ALPHABET = LINK_CODE_ALPHABET;

/** Spaces and dashes users type between code groups. */
const CODE_SEPARATORS = /[\s-]/g;
const CODE_CHARACTERS = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/;

const codeOf = (length: number, message: string) =>
  z
    .string()
    .transform((s) => s.replace(CODE_SEPARATORS, "").toUpperCase())
    .pipe(z.string().length(length).regex(CODE_CHARACTERS, message));

/** Code of a web login request in the page URL; spaces and dashes are ignored, lower case accepted. */
export const WebLoginCode = codeOf(
  WEB_LOGIN_CODE_LENGTH,
  "invalid web login code"
);
export type WebLoginCode = z.infer<typeof WebLoginCode>;

/**
 * The code the game shows ("ABC-DEF") and the player types on the confirmation page. It is never
 * part of a URL, so a link alone (or a glance at the address bar) does not finish a login.
 */
export const WebLoginUserCode = codeOf(
  WEB_LOGIN_USER_CODE_LENGTH,
  "invalid confirmation code"
);
export type WebLoginUserCode = z.infer<typeof WebLoginUserCode>;

/** Secrets of a request (`browserSecret`, `browserToken`, `pollSecret`, `confirmSecret`). */
const WebLoginSecret = z.string().min(16).max(256);

/** Browser flows of the web login: `POST /auth/oauth/:provider/start` (`steam` = Steam OpenID). */
export const WebLoginProvider = z.enum(["google", "apple", "discord", "steam"]);
export type WebLoginProvider = z.infer<typeof WebLoginProvider>;

/**
 * `sign_in` = the game signs in to the account behind the proven login (created if new);
 * `link` = the proven login is added to the account of the session that started the request
 * ("Konto sichern", "Anmeldung hinzufügen"); an account that already owns the login is merged
 * by D-122/D-188. Either way the browser confirms before anything happens (typed code).
 */
export const WebLoginIntent = z.enum(["sign_in", "link"]);
export type WebLoginIntent = z.infer<typeof WebLoginIntent>;

/** Language of the mails of a request. */
export const MailLocale = z.enum(["en", "de"]);
export type MailLocale = z.infer<typeof MailLocale>;

/**
 * POST /auth/web-login (no body needed) -> 201 `WebLoginStartResponse`. `intent: "link"` needs the
 * player session (`Authorization: Bearer`, else 401). The game opens `url`
 * (`<WEB_URL>/login/<code>#k=<browserSecret>`; the fragment never reaches a server log; the page
 * trades `k` once for a `browserToken`, POST /auth/web-login/claim), shows
 * `userCode` ("ABC-DEF") with the hint to type it in the browser, and polls every
 * `pollIntervalSeconds`. Errors: 400 `validation_error`, 401, 403 `banned`, 429 `rate_limited`.
 */
export const WebLoginStartRequest = z.object({
  intent: WebLoginIntent.optional().default("sign_in"),
  locale: MailLocale.optional(),
});
export type WebLoginStartRequest = z.input<typeof WebLoginStartRequest>;

export const WebLoginStartResponse = z.object({
  /** Identifies the request in the page URL; the page shows it only as a reference. */
  code: z.string(),
  /** Shown in the game, typed by the player on the confirmation page; never in a URL. */
  userCode: z.string(),
  /** Only for the game: needed to collect the session; never put it into a URL. */
  pollSecret: z.string(),
  /**
   * For the browser only, as `#k=` in `url`. Works once: the page trades it for a `browserToken`
   * (POST /auth/web-login/claim); afterwards `k` is worthless.
   */
  browserSecret: z.string(),
  url: z.string(),
  expiresAt: IsoDateTime,
  pollIntervalSeconds: z.number().int().min(1),
});
export type WebLoginStartResponse = z.infer<typeof WebLoginStartResponse>;

/**
 * State of a request: `pending` (waiting for a login in the browser), `awaiting_confirm` (the
 * browser proved a login; the player has to confirm there with the code from the game),
 * `completed` (session ready), `failed` (`error`), `expired` (past its lifetime or collected).
 */
export const WebLoginStatus = z.enum([
  "pending",
  "awaiting_confirm",
  "completed",
  "failed",
  "expired",
]);
export type WebLoginStatus = z.infer<typeof WebLoginStatus>;

/** `signed_in` (intent sign_in) or `linked` (intent link; also after a merge). */
export const WebLoginResult = z.enum(["signed_in", "linked"]);
export type WebLoginResult = z.infer<typeof WebLoginResult>;

/** POST /auth/web-login/poll. Unknown code or wrong secret: 404 `web_login_not_found`. */
export const WebLoginPollRequest = z.object({
  code: WebLoginCode,
  pollSecret: WebLoginSecret,
});
export type WebLoginPollRequest = z.input<typeof WebLoginPollRequest>;

/**
 * 200 of POST /auth/web-login/poll. `completed` carries the session exactly once (later polls
 * answer `expired`); with intent `link` it is a new session of the remaining account (the old
 * token stops working if the own account was absorbed, `removedPlayerId`). `failed.error`:
 * `banned` (with `reason`, `expiresAt`), `merge_blocked_banned`, `account_gone`,
 * `email_unavailable`, `too_many_attempts`.
 */
export const WebLoginPollResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("awaiting_confirm") }),
  z.object({ status: z.literal("expired") }),
  z.object({
    status: z.literal("failed"),
    error: z.string(),
    reason: z.string().nullable().optional(),
    expiresAt: IsoDateTime.nullable().optional(),
  }),
  z.object({
    status: z.literal("completed"),
    result: WebLoginResult,
    provider: IdentityProvider,
    merged: z.boolean(),
    removedPlayerId: Uuid.nullable(),
    auth: AuthResponse,
  }),
]);
export type WebLoginPollResponse = z.infer<typeof WebLoginPollResponse>;

/** Two accounts that the confirmation joins (D-122): which stays, which goes. */
export const WebLoginMerge = z.object({
  /** Stays (with progress on both sides: the older `createdAt`). */
  remaining: AccountSummary,
  /** Gets absorbed and deleted. */
  removed: AccountSummary,
  /** true = both have progress (a real merge); false = an empty account is absorbed. */
  bothHaveProgress: z.boolean(),
});
export type WebLoginMerge = z.infer<typeof WebLoginMerge>;

/** Name and level of an account on the page. */
export const WebLoginAccount = z.object({
  name: z.string(),
  level: PlayerLevel,
});
export type WebLoginAccount = z.infer<typeof WebLoginAccount>;

/** Header that carries the `browserToken` (never in a URL). */
export const WEB_LOGIN_BROWSER_TOKEN_HEADER = "x-browser-token";

/**
 * GET /auth/web-login/:code (public, rate limited; the website page `/login/<code>`):
 * - without credentials: only `status` and `expiresAt` (`authorized: false`);
 * - with the header `x-browser-token: <browserToken>`: also `intent`, `methods` (browser
 *   providers, `email`), `provider`, `result`, `error`, `attemptsLeft` (`authorized: true`);
 * - with `?confirm=<confirmSecret>` (the browser that proved a login): additionally the account
 *   data: `account` (the account the game ends up on once confirmed; null + `newAccount` for a
 *   sign-in that creates one), `merge` (two accounts the confirmation joins) and `ban`.
 * Unknown code: 404 `web_login_not_found`.
 */
export const WebLoginInfo = z.object({
  code: z.string(),
  status: WebLoginStatus,
  expiresAt: IsoDateTime,
  authorized: z.boolean(),
  intent: WebLoginIntent.nullable(),
  account: WebLoginAccount.nullable(),
  newAccount: z.boolean(),
  methods: z.array(z.enum(["email", ...WebLoginProvider.options])),
  provider: IdentityProvider.nullable(),
  result: WebLoginResult.nullable(),
  merged: z.boolean(),
  error: z.string().nullable(),
  merge: WebLoginMerge.nullable(),
  ban: z
    .object({ reason: z.string(), expiresAt: IsoDateTime.nullable() })
    .nullable(),
  /** Wrong typed codes left before the request fails (while `awaiting_confirm`). */
  attemptsLeft: z.number().int().min(0).nullable(),
  /**
   * Only in the answer of POST /auth/magic-link/verify: the secret for the confirmation. Browser
   * flows get it as `?confirm=` on the redirect back to the page.
   */
  confirmSecret: z.string().optional(),
});
export type WebLoginInfo = z.infer<typeof WebLoginInfo>;

/** `?confirm=` of GET /auth/web-login/:code (the browser token goes in a header). */
export const WebLoginInfoQuery = z.object({
  confirm: WebLoginSecret.optional(),
});
export type WebLoginInfoQuery = z.infer<typeof WebLoginInfoQuery>;

/**
 * POST /auth/web-login/confirm (from the browser that proved the login; rate limited) ->
 * `WebLoginInfo`. `typedCode` = the code the game shows (`userCode`). Only now does the request
 * finish: sign-in, adding the login, absorbing an empty account or merging two with progress.
 * Errors: 404 `web_login_not_found` (also wrong `confirmSecret`), 409 `web_login_not_confirmable`
 * (not waiting for a confirmation), 400 `wrong_code` (body `attemptsLeft`; at 0 the request is
 * `failed` with `too_many_attempts`), 429 `rate_limited`.
 */
export const WebLoginConfirmRequest = z.object({
  code: WebLoginCode,
  confirmSecret: WebLoginSecret,
  typedCode: z.string().trim().min(1).max(32),
});
export type WebLoginConfirmRequest = z.input<typeof WebLoginConfirmRequest>;

/**
 * POST /auth/web-login/claim `{ code, k }` (the website, once per request) -> 200
 * `WebLoginClaimResponse`. Trades the browser secret from the URL fragment for a `browserToken`;
 * from then on `k` is worthless, so a URL seen in history, on screen or in a proxy log starts
 * nothing. The website keeps the token (e.g. in an httpOnly cookie) and sends it as
 * `x-browser-token` or in the bodies below. Errors: 404 `web_login_not_found` (unknown code or
 * wrong `k`), 409 `web_login_claimed` (already claimed: "link already used, start again in the
 * game"), 409 `web_login_not_pending`, 429 `rate_limited`.
 */
export const WebLoginClaimRequest = z.object({
  code: WebLoginCode,
  k: WebLoginSecret,
});
export type WebLoginClaimRequest = z.input<typeof WebLoginClaimRequest>;

export const WebLoginClaimResponse = z.object({
  browserToken: z.string(),
  /** Same as the request's expiry. */
  expiresAt: IsoDateTime,
});
export type WebLoginClaimResponse = z.infer<typeof WebLoginClaimResponse>;

/**
 * POST /auth/oauth/:provider/start, a form post of the website page
 * (`application/x-www-form-urlencoded`, fields `code`, `browserToken`): sets a short-lived
 * binding cookie and answers 303 to the provider. Without the matching token, or when the request
 * is not open, 303 back to the page with `?error=` (`web_login_not_found`,
 * `web_login_not_pending`, `provider_not_configured`).
 */
export const OAuthStartForm = z.object({
  code: WebLoginCode,
  browserToken: WebLoginSecret,
});
export type OAuthStartForm = z.input<typeof OAuthStartForm>;

/**
 * GET /auth/oauth/:provider/callback: what the provider sends back (`code`, `state`, `error`;
 * Steam OpenID: `state` plus the `openid.*` values). Registered redirect URI at Google, Discord
 * and Apple: `<BETTER_AUTH_URL>/auth/oauth/<provider>/callback`.
 */
export const OAuthCallbackQuery = z
  .object({
    state: z.string().max(256).optional(),
    code: z.string().max(4096).optional(),
    error: z.string().max(256).optional(),
  })
  .catchall(z.string().max(4096));
export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuery>;

/**
 * Redirects of the browser flows (OAuth, Steam OpenID) end on the website:
 * `<WEB_URL>/login/<code>?confirm=<secret>` after a proven login (confirmation page) or
 * `<WEB_URL>/login/<code>?error=<code>` (`cancelled`, `provider_error`, `invalid_oauth_code`,
 * ...); without a usable request `<WEB_URL>/login?error=<code>`.
 */
export const WEB_LOGIN_PAGE_PATH = "/login";

// --- magic link (P-036) -------------------------------------------------------------------------

/**
 * POST /auth/magic-link -> 202 `{ sent: true }` (always the same answer: nothing tells whether an
 * address has an account; the mail goes out after the answer). Needs the `browserToken`. Sends a link
 * `<WEB_URL>/login/magic?token=...` valid MAGIC_LINK_TTL_SECONDS, once, bound to the request.
 * Errors: 400 `validation_error`, 404 `web_login_not_found` (also wrong token), 409
 * `web_login_not_pending`, 429 `rate_limited`, 501 `provider_not_configured` (no mail adapter).
 */
export const MagicLinkRequest = z.object({
  email: z
    .string()
    .trim()
    .transform((s) => s.toLowerCase())
    .pipe(z.email().max(254)),
  code: WebLoginCode,
  browserToken: WebLoginSecret,
  locale: MailLocale.optional(),
});
export type MagicLinkRequest = z.input<typeof MagicLinkRequest>;

export const MagicLinkSentResponse = z.object({ sent: z.literal(true) });
export type MagicLinkSentResponse = z.infer<typeof MagicLinkSentResponse>;

/** Token from the magic link URL. */
export const MagicLinkToken = z.string().trim().min(20).max(256);

/** `?token=` of GET /auth/magic-link/preview. */
export const MagicLinkPreviewQuery = z.object({ token: MagicLinkToken });
export type MagicLinkPreviewQuery = z.infer<typeof MagicLinkPreviewQuery>;

/**
 * GET /auth/magic-link/preview?token= (does not use the token up; mail scanners only open
 * links). The page says prominently that ANOTHER device (a game) gets signed in, shows the intent
 * and for `link` the account that gets the address, then the button "Continue". Errors: 400
 * `invalid_magic_link`.
 */
export const MagicLinkPreview = z.object({
  intent: WebLoginIntent,
  account: WebLoginAccount.nullable(),
  expiresAt: IsoDateTime,
});
export type MagicLinkPreview = z.infer<typeof MagicLinkPreview>;

/**
 * POST /auth/magic-link/verify `{ token }` (the button on the page) -> `WebLoginInfo` with
 * `status: "awaiting_confirm"` and `confirmSecret`: the page then asks for the code from the game
 * (POST /auth/web-login/confirm). The token works once. Errors: 400 `invalid_magic_link`
 * (unknown, used or expired), 409 `web_login_not_pending`, 429 `rate_limited`.
 */
export const MagicLinkVerifyRequest = z.object({ token: MagicLinkToken });
export type MagicLinkVerifyRequest = z.infer<typeof MagicLinkVerifyRequest>;

// --- Sign in with Apple in the iOS app (D-188 (2)) ---------------------------------------------

/** TESTWERT: lifetime of a nonce from POST /auth/apple/nonce. */
export const APPLE_NONCE_TTL_SECONDS = 300;

/**
 * POST /auth/apple/nonce (no body, rate limited) -> 201: a one-time nonce. The app puts
 * SHA-256(nonce) (hex) into the Apple request and sends the raw nonce with the identity token;
 * the server accepts each nonce once, within APPLE_NONCE_TTL_SECONDS.
 */
export const AppleNonceResponse = z.object({
  nonce: z.string(),
  expiresAt: IsoDateTime,
});
export type AppleNonceResponse = z.infer<typeof AppleNonceResponse>;

/** A nonce from POST /auth/apple/nonce. */
export const AppleNonce = z.string().trim().min(16).max(256);

/**
 * POST /auth/apple (iOS app, native Sign in with Apple) -> `AuthResponse`. The server verifies
 * `identityToken` against Apple's keys (issuer, audience = APPLE_APP_BUNDLE_ID, expiry) and that
 * its nonce is the server-issued `nonce` (raw or SHA-256 hex, used up), and exchanges
 * `authorizationCode` for a refresh token that is revoked when the account is deleted. Request no
 * name or e-mail scope; the server stores neither. Errors: 400 `validation_error` (no nonce), 501
 * `provider_not_configured`, 401 `invalid_apple_token` (also unknown or used nonce), 502
 * `apple_unavailable`, 403 `banned`, 429 `rate_limited`.
 */
export const AppleNativeAuthRequest = z.object({
  identityToken: z.string().trim().min(20).max(8192),
  authorizationCode: z.string().trim().min(1).max(2048).optional(),
  /** The raw nonce from POST /auth/apple/nonce. */
  nonce: AppleNonce,
  name: PlayerName.optional(),
  appearance: PlayerAppearance.optional(),
});
export type AppleNativeAuthRequest = z.infer<typeof AppleNativeAuthRequest>;

// --- add a login inside the game (P-036 (2)) ----------------------------------------------------

/**
 * POST /me/logins (player session): proves a further login inside the game and adds it to the
 * own account. Same proofs as the logins: Steam ticket, Play Games server auth code, Apple identity
 * token, Game Center signature, or the device id of a guest account on this device. If the login
 * already belongs to another account, D-122/D-188 apply as for link codes: an empty account is
 * absorbed silently, both with progress → 409 `account_has_progress` (body
 * `AccountHasProgressResponse`) until the call is repeated with `confirmMerge: true`; banned →
 * 409 `merge_blocked_banned`. Answer `AddLoginResponse`. Errors as the logins (401 invalid proof,
 * 501 `provider_not_configured`, 502 provider unavailable), 429 `rate_limited`.
 */
export const AddLoginRequest = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("steam"),
    ticket: SteamAuthRequest.shape.ticket,
    confirmMerge: z.boolean().optional().default(false),
  }),
  z.object({
    provider: z.literal("google_play"),
    serverAuthCode: z.string().trim().min(10).max(2048),
    confirmMerge: z.boolean().optional().default(false),
  }),
  z.object({
    provider: z.literal("apple"),
    identityToken: AppleNativeAuthRequest.shape.identityToken,
    authorizationCode: AppleNativeAuthRequest.shape.authorizationCode,
    nonce: AppleNativeAuthRequest.shape.nonce,
    confirmMerge: z.boolean().optional().default(false),
  }),
  GameCenterAuthRequest.omit({ name: true, appearance: true }).extend({
    provider: z.literal("game_center"),
    confirmMerge: z.boolean().optional().default(false),
  }),
  z.object({
    provider: z.literal("device"),
    deviceId: GuestDeviceId,
    confirmMerge: z.boolean().optional().default(false),
  }),
]);
export type AddLoginRequest = z.input<typeof AddLoginRequest>;

/**
 * 200 of POST /me/logins and the result of a `link` web login: a fresh session of the remaining
 * account (the caller's account, or the other one when the caller's empty account was absorbed;
 * then the old token stops working).
 */
export const AddLoginResponse = AuthResponse.extend({
  /** true = both accounts had progress and were merged (after `confirmMerge`). */
  merged: z.boolean(),
  /** The absorbed account, null if the login was new or already on this account. */
  removedPlayerId: Uuid.nullable(),
  identities: z.array(IdentitySummary),
});
export type AddLoginResponse = z.infer<typeof AddLoginResponse>;
