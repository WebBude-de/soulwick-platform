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
/** TESTWERT: lifetime of a web login request (code and poll secret). */
export const WEB_LOGIN_TTL_SECONDS = 600;
/** How often the game asks POST /auth/web-login/poll. */
export const WEB_LOGIN_POLL_INTERVAL_SECONDS = 2;
/** TESTWERT: lifetime of a magic link. */
export const MAGIC_LINK_TTL_SECONDS = 900;
export const WEB_LOGIN_CODE_ALPHABET = LINK_CODE_ALPHABET;

/** Code of a web login request; spaces and dashes are ignored, lower case accepted. */
export const WebLoginCode = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .length(WEB_LOGIN_CODE_LENGTH)
      .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/, "invalid web login code")
  );
export type WebLoginCode = z.infer<typeof WebLoginCode>;

/** Browser flows of the web login: `GET /auth/oauth/:provider/start` (`steam` = Steam OpenID). */
export const WebLoginProvider = z.enum(["google", "apple", "discord", "steam"]);
export type WebLoginProvider = z.infer<typeof WebLoginProvider>;

/**
 * `sign_in` = the game signs in to the account behind the proven login (created if new);
 * `link` = the proven login is added to the account of the session that started the request
 * ("Konto sichern", "Anmeldung hinzufügen"); an account that already owns the login is merged
 * by D-122/D-188 (empty account silently, both with progress only after the browser confirms).
 */
export const WebLoginIntent = z.enum(["sign_in", "link"]);
export type WebLoginIntent = z.infer<typeof WebLoginIntent>;

/** Language of the mails of a request. */
export const MailLocale = z.enum(["en", "de"]);
export type MailLocale = z.infer<typeof MailLocale>;

/**
 * POST /auth/web-login (no body needed) -> 201 `WebLoginStartResponse`. `intent: "link"` needs the
 * player session (`Authorization: Bearer`, else 401). The game opens `url`
 * (`<WEB_URL>/login/<code>`), shows `code` to compare and polls every `pollIntervalSeconds`.
 * The website's server may start a request the same way for a login on the website itself.
 * Errors: 400 `validation_error`, 401, 403 `banned`, 429 `rate_limited`.
 */
export const WebLoginStartRequest = z.object({
  intent: WebLoginIntent.optional().default("sign_in"),
  locale: MailLocale.optional(),
});
export type WebLoginStartRequest = z.input<typeof WebLoginStartRequest>;

export const WebLoginStartResponse = z.object({
  code: z.string(),
  /** Only for the game: needed to collect the session; never put it into a URL. */
  pollSecret: z.string(),
  url: z.string(),
  expiresAt: IsoDateTime,
  pollIntervalSeconds: z.number().int().min(1),
});
export type WebLoginStartResponse = z.infer<typeof WebLoginStartResponse>;

/**
 * State of a request: `pending` (waiting for the browser), `confirm_merge` (both accounts have
 * progress, the browser has to confirm), `completed` (session ready), `failed` (`error`), `expired`
 * (past its lifetime or already collected).
 */
export const WebLoginStatus = z.enum([
  "pending",
  "confirm_merge",
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
  pollSecret: z.string().min(16).max(256),
});
export type WebLoginPollRequest = z.input<typeof WebLoginPollRequest>;

/**
 * 200 of POST /auth/web-login/poll. `completed` carries the session exactly once (later polls
 * answer `expired`); with intent `link` it is a new session of the remaining account (the old
 * token stops working if the own account was absorbed, `removedPlayerId`). `failed.error`:
 * `banned` (with `reason`, `expiresAt`), `merge_blocked_banned`, `account_gone`, `provider_error`,
 * `cancelled`, `email_unavailable`.
 */
export const WebLoginPollResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("confirm_merge") }),
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

/** Both accounts of a merge waiting for the browser's confirmation (like AccountHasProgressResponse). */
export const WebLoginMerge = z.object({
  /** Stays (older `createdAt`). */
  remaining: AccountSummary,
  /** Gets absorbed and deleted. */
  removed: AccountSummary,
});
export type WebLoginMerge = z.infer<typeof WebLoginMerge>;

/**
 * GET /auth/web-login/:code[?confirm=<confirmSecret>] (public; for the website page
 * `/login/<code>`). `account` = the account a `link` request adds the login to (name and level
 * only). `methods` = login methods the page can offer (browser providers, `email`). `merge` only
 * with the matching `confirm` secret while `status` is `confirm_merge`. Unknown code: 404
 * `web_login_not_found`.
 */
export const WebLoginInfo = z.object({
  code: z.string(),
  intent: WebLoginIntent,
  status: WebLoginStatus,
  expiresAt: IsoDateTime,
  account: z.object({ name: z.string(), level: PlayerLevel }).nullable(),
  methods: z.array(z.enum(["email", ...WebLoginProvider.options])),
  provider: IdentityProvider.nullable(),
  result: WebLoginResult.nullable(),
  merged: z.boolean(),
  error: z.string().nullable(),
  merge: WebLoginMerge.nullable(),
  /**
   * Only in the answer of the step that found the merge (magic link verify): the secret for
   * POST /auth/web-login/confirm-merge. Browser flows get it as `?confirm=` on the redirect.
   */
  confirmSecret: z.string().optional(),
});
export type WebLoginInfo = z.infer<typeof WebLoginInfo>;

/**
 * POST /auth/web-login/confirm-merge (from the browser that proved the login) -> `WebLoginInfo`.
 * Errors: 404 `web_login_not_found` (also wrong secret), 409 `web_login_not_confirmable`
 * (not waiting for a merge), 409 `merge_blocked_banned`, 429 `rate_limited`.
 */
export const WebLoginConfirmMergeRequest = z.object({
  code: WebLoginCode,
  confirmSecret: z.string().min(16).max(256),
});
export type WebLoginConfirmMergeRequest = z.input<
  typeof WebLoginConfirmMergeRequest
>;

/** `?confirm=` of GET /auth/web-login/:code. */
export const WebLoginInfoQuery = z.object({
  confirm: z.string().min(16).max(256).optional(),
});
export type WebLoginInfoQuery = z.infer<typeof WebLoginInfoQuery>;

/**
 * GET /auth/oauth/:provider/start?code=<web login code> (a link on the website page): sets a
 * short-lived binding cookie and redirects to the provider. Problems redirect back to the page
 * with `?error=` (`provider_not_configured`, `web_login_not_pending`).
 */
export const OAuthStartQuery = z.object({ code: WebLoginCode });
export type OAuthStartQuery = z.input<typeof OAuthStartQuery>;

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
 * `<WEB_URL>/login/<code>` plus `?confirm=<secret>` when a merge waits for confirmation or
 * `?error=<code>` (`cancelled`, `provider_error`, `invalid_state`, ...); without a usable request
 * `<WEB_URL>/login?error=<code>`. The page then reads `GET /auth/web-login/:code`.
 */
export const WEB_LOGIN_PAGE_PATH = "/login";

// --- magic link (P-036) -------------------------------------------------------------------------

/**
 * POST /auth/magic-link -> 202 `{ sent: true }` (always the same answer: nothing tells whether an
 * address has an account). Sends a link `<WEB_URL>/login/magic?token=...` valid
 * MAGIC_LINK_TTL_SECONDS, once, bound to the web login request `code` (the mail shows that code).
 * Errors: 400 `validation_error`, 404 `web_login_not_found`, 409 `web_login_not_pending`,
 * 429 `rate_limited`, 501 `provider_not_configured` (no mail adapter).
 */
export const MagicLinkRequest = z.object({
  email: z
    .string()
    .trim()
    .transform((s) => s.toLowerCase())
    .pipe(z.email().max(254)),
  code: WebLoginCode,
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
 * links). What the page shows before the button "Continue": the code of the request, the intent
 * and for `link` the account that gets the address. Errors: 400 `invalid_magic_link`.
 */
export const MagicLinkPreview = z.object({
  code: z.string(),
  intent: WebLoginIntent,
  account: z.object({ name: z.string(), level: PlayerLevel }).nullable(),
  expiresAt: IsoDateTime,
});
export type MagicLinkPreview = z.infer<typeof MagicLinkPreview>;

/**
 * POST /auth/magic-link/verify `{ token }` (the button on the page) -> `WebLoginInfo` of the
 * request (with `confirmSecret` + `merge` when a merge waits for confirmation). The token works
 * once. Errors: 400 `invalid_magic_link` (unknown, used or expired), 429 `rate_limited`.
 */
export const MagicLinkVerifyRequest = z.object({ token: MagicLinkToken });
export type MagicLinkVerifyRequest = z.infer<typeof MagicLinkVerifyRequest>;

// --- Sign in with Apple in the iOS app (D-188 (2)) ---------------------------------------------

/**
 * POST /auth/apple (iOS app, native Sign in with Apple) -> `AuthResponse`. The server verifies
 * `identityToken` against Apple's keys (issuer, audience = APPLE_APP_BUNDLE_ID, expiry, nonce)
 * and exchanges `authorizationCode` for a refresh token that is revoked when the account is
 * deleted. Request no name or e-mail scope; the server stores neither. Errors: 501
 * `provider_not_configured`, 401 `invalid_apple_token`, 502 `apple_unavailable`, 403 `banned`,
 * 429 `rate_limited`.
 */
export const AppleNativeAuthRequest = z.object({
  identityToken: z.string().trim().min(20).max(8192),
  authorizationCode: z.string().trim().min(1).max(2048).optional(),
  /** The raw nonce the app put (hashed) into the request; checked if given. */
  nonce: z.string().trim().min(1).max(256).optional(),
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
