import type {
  MagicLinkRequest,
  WebLoginClaimRequest,
  WebLoginConfirmRequest,
  WebLoginInfo,
  WebLoginMerge,
  WebLoginProvider,
  WebLoginStatus,
} from "@soulwick/contracts";

/**
 * The one place that knows the API side of the web login (KF11, KF5 after both security reviews):
 * paths, field and header names, and how an API answer becomes the `LoginState` the pages render.
 * If api-dev renames something, only this file changes. Safe for client components.
 *
 * Flow: the game opens `/login/<code>#k=<browserSecret>`. An inline script moves `k` out of the
 * address bar into sessionStorage before the first paint; the page trades it once for a
 * `browserToken` (`claim`), which the website keeps in an httpOnly cookie (path `/login`) and
 * sends as a header, never in a URL. Provider buttons post `code` + `browserToken` to the API.
 * After the proof at Google, Apple, Discord, Steam or by magic link the API sends the browser back
 * with a one-time `?confirm=` secret; the page shows which account gets signed in and asks for
 * the short code the game shows (`userCode`, typed as `typedCode`).
 */
export const LOGIN_API = {
  /** POST `{ code, k }` → `{ browserToken, expiresAt }`; 409 `web_login_claimed`. */
  claim: "/auth/web-login/claim",
  /** GET: state of a request; details with the token header, account data with `?confirm=`. */
  info: (code: string) => `/auth/web-login/${encodeURIComponent(code)}`,
  infoConfirmParam: "confirm",
  /** Same value as `WEB_LOGIN_BROWSER_TOKEN_HEADER` in the contract (checked by a test). */
  tokenHeader: "x-browser-token",
  /** Form post (`code`, `browserToken`) the browser sends; the API answers 303 to the provider. */
  oauthStart: (provider: string) =>
    `/auth/oauth/${encodeURIComponent(provider)}/start`,
  oauthCodeField: "code",
  oauthTokenField: "browserToken",
  /** POST `MagicLinkRequest` `{ email, code, browserToken, locale? }`, always 202. */
  magicLink: "/auth/magic-link",
  /** GET `?token=` (does not use the link up). */
  magicPreview: "/auth/magic-link/preview",
  /** POST `{ token }`: answers the request with the confirm secret. */
  magicVerify: "/auth/magic-link/verify",
  /** POST `WebLoginConfirmRequest`: finishes the login (400 `wrong_code`). */
  confirm: "/auth/web-login/confirm",
} as const;

/** Name of the browser key in the URL fragment the game opens (`#k=…`). */
export const FRAGMENT_KEY = "k";

/** sessionStorage key of the browser key until it is traded for the token. */
export const keyStorageName = (code: string) => `soulwick.login.k.${code}`;

/** Fallback when sessionStorage is off (private mode): a window property of this page view. */
export const KEY_WINDOW_PROPERTY = "__soulwickLoginKey";

/** Cookie of the website that keeps the browser token of one request (httpOnly, path `/login`). */
export const tokenCookieName = (code: string) => `sw_login_${code}`;
export const TOKEN_COOKIE_PATH = "/login";

/**
 * Inline script for the `<head>` of every page (root layout): on `/login/<code>` it takes `#k=`
 * out of the address bar before the first paint, so it is not on screen, in screenshots or in the
 * history, and keeps it in sessionStorage (or a window property when storage is off) under the
 * normalised code, as `keyStorageName` names it. Elsewhere it does nothing. No data from outside
 * goes into the script text.
 */
export const FRAGMENT_SCRIPT = `(function(){try{var m=/^\\/login\\/([A-Za-z0-9-]+)\\/?$/.exec(location.pathname);if(!m||!location.hash)return;var k=new URLSearchParams(location.hash.slice(1)).get(${JSON.stringify(FRAGMENT_KEY)});if(!k)return;var c=m[1].replace(/-/g,"").toUpperCase();window[${JSON.stringify(KEY_WINDOW_PROPERTY)}]=k;try{sessionStorage.setItem(${JSON.stringify("soulwick.login.k.")}+c,k)}catch(e){}history.replaceState(history.state,"",location.pathname+location.search)}catch(e){}})();`;

/** Same order as `WebLoginProvider` (kept as a plain list so client code needs no zod). */
export const LOGIN_PROVIDERS = [
  "google",
  "apple",
  "discord",
  "steam",
] as const satisfies readonly WebLoginProvider[];
export type LoginProvider = WebLoginProvider;

/** `pending` = choose a login, `awaiting_confirm` = type the code from the game. */
export type LoginStatus = WebLoginStatus;

/** Bodies of the POST routes, checked against the contract at compile time. */
export type ClaimBody = WebLoginClaimRequest;
export type MagicLinkBody = MagicLinkRequest;
export type ConfirmBody = WebLoginConfirmRequest;

export interface LoginAccount {
  level: number | null;
  name: string;
}

/** What the pages render; built from the API answer by `toLoginState`. */
/** Contract of KF5: `WebLoginInfo` in `packages/contracts/src/login.ts`. */
export interface LoginState {
  /** The account the game gets signed in to (or that gets the new login). */
  account: LoginAccount | null;
  /** Wrong codes left before the request ends, if the API tells. */
  attemptsLeft: number | null;
  ban: { expiresAt: string | null; reason: string | null } | null;
  code: string;
  error: string | null;
  expiresAt: string | null;
  intent: "sign_in" | "link";
  merge: WebLoginMerge | null;
  merged: boolean;
  /** Browser providers and `email` configured on this server. */
  methods: string[];
  /** A sign-in that creates a new account once confirmed. */
  newAccount: boolean;
  provider: string | null;
  /** The API answered without the browser key: no details, only whether the request lives. */
  restricted: boolean;
  result: "signed_in" | "linked" | null;
  status: LoginStatus;
}

/** Problems that end the page before a state can be shown. */
export type LoadProblem =
  | "web_login_not_found"
  | "web_login_claimed"
  | "rate_limited"
  | "unreachable"
  | "generic";

/**
 * Answer of `openLogin` (Server Action) and `fetchLoginState`. `browserToken` goes back to the
 * page only for the provider forms and the e-mail form (kept in memory, never stored there).
 */
export type LoadResult =
  | { ok: true; state: LoginState; browserToken: string | null }
  | { ok: false; problem: LoadProblem };

/**
 * Turns an answer of the info, verify or confirm route (`WebLoginInfo`) into a `LoginState`.
 * Defensive on purpose: an older or newer API must not break the page.
 */
export function toLoginState(
  raw: WebLoginInfo | unknown,
  code: string
): LoginState {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const result = oneOf(data.result, ["signed_in", "linked"] as const);
  const rawStatus = str(data.status);
  let status: LoginStatus = "expired";
  if (
    rawStatus === "pending" ||
    rawStatus === "awaiting_confirm" ||
    rawStatus === "failed"
  ) {
    status = rawStatus;
  } else if (rawStatus === "completed" || (rawStatus && result)) {
    // A collected request reads `expired` but keeps its result: the game got its session.
    status = "completed";
  }
  return {
    code: str(data.code) ?? code,
    status,
    intent: data.intent === "link" ? "link" : "sign_in",
    expiresAt: str(data.expiresAt),
    account: account(data.account),
    methods: Array.isArray(data.methods)
      ? data.methods.filter((m): m is string => typeof m === "string")
      : [],
    provider: str(data.provider),
    result,
    merged: data.merged === true,
    newAccount: data.newAccount === true,
    error: str(data.error),
    merge: isMerge(data.merge) ? data.merge : null,
    ban: ban(data.ban),
    attemptsLeft:
      typeof data.attemptsLeft === "number" ? data.attemptsLeft : null,
    restricted:
      data.authorized === false ||
      (data.authorized === undefined && !Array.isArray(data.methods)),
  };
}

/** Form action of a provider button: `POST <api>/auth/oauth/<provider>/start`. */
export function oauthStartAction(
  apiBase: string,
  provider: LoginProvider
): string {
  return `${apiBase}${LOGIN_API.oauthStart(provider)}`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]) {
  return options.includes(value as T) ? (value as T) : null;
}

function account(value: unknown): LoginAccount | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const { name, level } = value as Record<string, unknown>;
  return typeof name === "string"
    ? { name, level: typeof level === "number" ? level : null }
    : null;
}

function ban(value: unknown): LoginState["ban"] {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const { reason, expiresAt } = value as Record<string, unknown>;
  return { reason: str(reason), expiresAt: str(expiresAt) };
}

function isMerge(value: unknown): value is WebLoginMerge {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const { remaining, removed } = value as Record<string, unknown>;
  return Boolean(
    remaining &&
      removed &&
      typeof remaining === "object" &&
      typeof removed === "object"
  );
}
