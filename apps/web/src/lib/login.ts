import "server-only";
import {
  type MagicLinkPreview,
  MagicLinkToken,
  WEB_LOGIN_PAGE_PATH,
  type WebLoginClaimResponse,
  WebLoginCode,
  type WebLoginInfo,
} from "@soulwick/contracts";
import { cookies, headers } from "next/headers";
import { type ApiResult, apiGetFresh, apiPost } from "@/lib/api";
import { forwardedFor } from "@/lib/client-ip";
import {
  type ClaimBody,
  type ConfirmBody,
  LOGIN_API,
  type LoadResult,
  type MagicLinkBody,
  TOKEN_COOKIE_PATH,
  tokenCookieName,
  toLoginState,
} from "@/lib/login-protocol";

/**
 * Server side of the login pages (KF11, P-036, P-039): the website renders `/login/<code>`,
 * `/login/magic` and `/login?error=` for the web login the game starts. It keeps no session; its
 * only cookie is the browser token of an open request (httpOnly, path `/login`). Every API call
 * runs on the website's server (paths and names in `login-protocol.ts`).
 */

const DEFAULT_API_URL = "http://localhost:3102";
const TRAILING_SLASHES = /\/+$/;

/**
 * Public address of the API for links the browser follows (`API_PUBLIC_URL`). Locally the
 * server-side `API_URL` is public as well, so it is the fallback; on Dokploy `API_URL` is the
 * internal address and `API_PUBLIC_URL` must be set. Read per request, no `NEXT_PUBLIC_`.
 */
export function apiPublicUrl(): string {
  for (const raw of [process.env.API_PUBLIC_URL, process.env.API_URL]) {
    const value = raw?.trim();
    if (!value) {
      continue;
    }
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return `${url.origin}${url.pathname.replace(TRAILING_SLASHES, "")}`;
      }
    } catch {
      // Not a URL: try the next variable.
    }
  }
  return DEFAULT_API_URL;
}

/** Normalised code from the URL (spaces, dashes and lower case allowed), or null. */
export function parseCode(raw: string | undefined): string | null {
  const parsed = WebLoginCode.safeParse(raw ?? "");
  return parsed.success ? parsed.data : null;
}

export function parseMagicToken(raw: string | undefined): string | null {
  const parsed = MagicLinkToken.safeParse(raw ?? "");
  return parsed.success ? parsed.data : null;
}

/**
 * State of a request. The browser token (header, never in the URL) unlocks the details, the
 * confirm secret also the account data. `browserToken` is handed back for the page's forms.
 */
export async function fetchLoginState(input: {
  code: string;
  browserToken?: string | null;
  confirm?: string;
}): Promise<LoadResult> {
  const query = input.confirm
    ? `?${new URLSearchParams({ [LOGIN_API.infoConfirmParam]: input.confirm })}`
    : "";
  const result = await apiGetFresh<unknown>(
    `${LOGIN_API.info(input.code)}${query}`,
    {
      ...(await forwardedFor()),
      ...(input.browserToken
        ? { [LOGIN_API.tokenHeader]: input.browserToken }
        : {}),
    }
  );
  if (result.ok) {
    return {
      ok: true,
      state: toLoginState(result.data, input.code),
      browserToken: input.browserToken ?? null,
    };
  }
  if (result.status === 404 || result.status === 400) {
    return { ok: false, problem: "web_login_not_found" };
  }
  if (result.status === 429) {
    return { ok: false, problem: "rate_limited" };
  }
  return {
    ok: false,
    problem: result.status === "unreachable" ? "unreachable" : "generic",
  };
}

/** Trades the browser key from the fragment once for a browser token. */
export async function postClaim(
  code: string,
  key: string
): Promise<ApiResult<WebLoginClaimResponse>> {
  const payload: ClaimBody = { code, k: key };
  return await apiPost<WebLoginClaimResponse>(
    LOGIN_API.claim,
    payload,
    await forwardedFor()
  );
}

/** The browser token of a request from the website's own cookie, if any. */
export async function readBrowserToken(code: string): Promise<string | null> {
  return (await cookies()).get(tokenCookieName(code))?.value || null;
}

/**
 * Keeps the browser token in an httpOnly cookie of the website (path `/login`, until the request
 * expires). Only from a Server Action. Technically necessary: without it a reload or the way
 * back from Google would lose the sign-in.
 */
export async function writeBrowserToken(
  code: string,
  token: string,
  expiresAt: string
): Promise<void> {
  const proto = (await headers()).get("x-forwarded-proto");
  const secure =
    proto === "https" || (process.env.SITE_URL ?? "").startsWith("https://");
  (await cookies()).set(tokenCookieName(code), token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: TOKEN_COOKIE_PATH,
    expires: new Date(expiresAt),
  });
}

export async function postMagicLink(body: {
  code: string;
  email: string;
  browserToken: string;
  locale?: string;
}): Promise<ApiResult<unknown>> {
  const payload: MagicLinkBody = {
    email: body.email,
    code: body.code,
    browserToken: body.browserToken,
    locale:
      body.locale === "de" || body.locale === "en" ? body.locale : undefined,
  };
  return await apiPost<unknown>(
    LOGIN_API.magicLink,
    payload,
    await forwardedFor()
  );
}

/** Uses the magic link up; the answer carries the request code and the confirm secret. */
export async function postMagicVerify(
  token: string
): Promise<ApiResult<WebLoginInfo>> {
  return await apiPost<WebLoginInfo>(
    LOGIN_API.magicVerify,
    { token },
    await forwardedFor()
  );
}

export async function postConfirm(body: {
  code: string;
  confirmSecret: string;
  typedCode: string;
}): Promise<ApiResult<unknown>> {
  const payload: ConfirmBody = {
    code: body.code,
    confirmSecret: body.confirmSecret,
    typedCode: body.typedCode,
  };
  return await apiPost<unknown>(
    LOGIN_API.confirm,
    payload,
    await forwardedFor()
  );
}

/** `GET /auth/magic-link/preview?token=`: does not use the link up. */
export async function fetchMagicPreview(
  token: string
): Promise<ApiResult<MagicLinkPreview>> {
  return await apiGetFresh<MagicLinkPreview>(
    `${LOGIN_API.magicPreview}?${new URLSearchParams({ token })}`,
    await forwardedFor()
  );
}

/** Whole minutes until `iso`, at least 0. */
export function minutesLeft(iso: string | null, now = Date.now()): number {
  if (!iso) {
    return 0;
  }
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000));
}

/** Path of a website login page plus query, for redirects (the URL carries no language). */
export function loginPagePath(
  sub: string | null,
  query: Record<string, string> = {}
): string {
  const params = new URLSearchParams(query).toString();
  return `${WEB_LOGIN_PAGE_PATH}${sub ? `/${sub}` : ""}${params ? `?${params}` : ""}`;
}

/** First value of a search param (Next gives arrays for repeated keys). */
export function param(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
