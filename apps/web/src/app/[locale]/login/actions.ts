"use server";

import {
  MagicLinkRequest,
  WebLoginCode,
  WebLoginUserCode,
} from "@soulwick/contracts";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/locale";
import {
  fetchLoginState,
  loginPagePath,
  parseMagicToken,
  postClaim,
  postConfirm,
  postMagicLink,
  postMagicVerify,
  readBrowserToken,
  writeBrowserToken,
} from "@/lib/login";
import {
  CODE_FIELD,
  CONFIRM_FIELD,
  type ConfirmState,
  EMAIL_FIELD,
  HONEYPOT_FIELD,
  LOCALE_FIELD,
  type MailNotice,
  type MailState,
  TOKEN_FIELD,
  TYPED_CODE_FIELD,
} from "@/lib/login-form";
import type { LoadResult } from "@/lib/login-protocol";

/**
 * Server Actions of the login pages (KF11). The browser key `k` exists only in the browser (URL
 * fragment, then sessionStorage), so the code page is driven by a client component that hands it
 * over once; `openLogin` trades it for the browser token and keeps that in an httpOnly cookie.
 * Every API call runs on the website's server; the API URL only reaches the browser as the
 * action of the provider forms.
 */

/**
 * Opens the page of a request: trades `key` (if the page still has it) for the browser token,
 * then reads the state with the token from the cookie and `confirm` from the URL.
 */
export async function openLogin(input: {
  code: string;
  key?: string;
  confirm?: string;
}): Promise<LoadResult> {
  const code = WebLoginCode.safeParse(input.code);
  if (!code.success) {
    return { ok: false, problem: "web_login_not_found" };
  }
  let browserToken = await readBrowserToken(code.data);
  if (input.key) {
    const claim = await postClaim(code.data, input.key);
    if (claim.ok) {
      browserToken = claim.data.browserToken;
      await writeBrowserToken(code.data, browserToken, claim.data.expiresAt);
    } else if (claim.status === 409 && claim.error === "web_login_claimed") {
      // Opened twice: the tab that claimed it keeps working, any other gets "link used".
      if (!browserToken) {
        return { ok: false, problem: "web_login_claimed" };
      }
    } else if (claim.status === 404) {
      return { ok: false, problem: "web_login_not_found" };
    } else if (claim.status === 429) {
      return { ok: false, problem: "rate_limited" };
    } else if (claim.status === "unreachable") {
      return { ok: false, problem: "unreachable" };
    }
    // 409 `web_login_not_pending`: finished or expired, the state below says which.
  }
  return await fetchLoginState({
    code: code.data,
    browserToken,
    confirm: input.confirm || undefined,
  });
}

/** "Send me a link": POST /auth/magic-link for the request on the page. */
export async function sendMagicLink(
  _previous: MailState,
  formData: FormData
): Promise<MailState> {
  const email = text(formData, EMAIL_FIELD);
  const fail = (notice: MailNotice): MailState => ({
    status: "error",
    notice,
    email,
  });
  // Bots fill every field: answer like a sent mail so they learn nothing, but send nothing.
  if (text(formData, HONEYPOT_FIELD) !== "") {
    return { status: "sent" };
  }
  const code = WebLoginCode.safeParse(text(formData, CODE_FIELD));
  if (!code.success) {
    return fail("closed");
  }
  const browserToken = await readBrowserToken(code.data);
  if (!browserToken) {
    return fail("closed");
  }
  const locale = text(formData, LOCALE_FIELD);
  const body = {
    email,
    code: code.data,
    browserToken,
    locale: isLocale(locale) ? locale : undefined,
  };
  if (!MagicLinkRequest.safeParse(body).success) {
    return fail("invalid");
  }
  const result = await postMagicLink(body);
  if (result.ok) {
    return { status: "sent" };
  }
  if (result.status === 404 || result.status === 409) {
    return fail("closed");
  }
  if (result.status === 429) {
    return fail("rate_limited");
  }
  if (result.status === 501) {
    return fail("not_configured");
  }
  return fail(result.status === 400 ? "invalid" : "unreachable");
}

/**
 * The button on `/login/magic`: uses the link up, then the request's page asks for the code
 * from the game (`?confirm=`). Works without JavaScript.
 */
export async function verifyMagicLink(formData: FormData): Promise<never> {
  const token = parseMagicToken(text(formData, TOKEN_FIELD));
  if (!token) {
    redirect(loginPagePath(null, { error: "invalid_magic_link" }));
  }
  const result = await postMagicVerify(token);
  if (result.ok && result.data.code) {
    const { code, confirmSecret } = result.data;
    redirect(
      loginPagePath(code, confirmSecret ? { confirm: confirmSecret } : {})
    );
  }
  if (!result.ok && result.status === 400) {
    redirect(loginPagePath(null, { error: "invalid_magic_link" }));
  }
  if (!result.ok && result.status === 409) {
    redirect(loginPagePath(null, { error: "web_login_not_pending" }));
  }
  // Nothing was used up: the same link works again in a moment.
  const error =
    !result.ok && result.status === 429 ? "rate_limited" : "unreachable";
  redirect(loginPagePath("magic", { token, error }));
}

/** "Sign in": POST the confirm route with the code the player typed from the game. */
export async function confirmLogin(
  _previous: ConfirmState,
  formData: FormData
): Promise<ConfirmState> {
  const code = WebLoginCode.safeParse(text(formData, CODE_FIELD));
  const confirmSecret = text(formData, CONFIRM_FIELD);
  if (!(code.success && confirmSecret)) {
    return { status: "error", notice: "wrong_code", attemptsLeft: null };
  }
  const typed = WebLoginUserCode.safeParse(text(formData, TYPED_CODE_FIELD));
  if (!typed.success) {
    return { status: "error", notice: "format", attemptsLeft: null };
  }
  const result = await postConfirm({
    code: code.data,
    confirmSecret,
    typedCode: typed.data,
  });
  if (!result.ok && result.status === 429) {
    return { status: "error", notice: "rate_limited", attemptsLeft: null };
  }
  if (!result.ok && result.status === "unreachable") {
    return { status: "error", notice: "unreachable", attemptsLeft: null };
  }
  // Whatever the answer (done, wrong code, used up, expired): the request's state decides.
  const latest = await fetchLoginState({
    code: code.data,
    browserToken: await readBrowserToken(code.data),
    confirm: confirmSecret,
  });
  if (!latest.ok) {
    return latest.problem === "unreachable"
      ? { status: "error", notice: "unreachable", attemptsLeft: null }
      : {
          status: "done",
          state: {
            ...emptyState(code.data),
            status: "failed",
            error: latest.problem,
          },
        };
  }
  if (!result.ok && latest.state.status === "awaiting_confirm") {
    return {
      status: "error",
      notice: "wrong_code",
      attemptsLeft: latest.state.attemptsLeft,
    };
  }
  return { status: "done", state: latest.state };
}

function emptyState(code: string) {
  return {
    account: null,
    attemptsLeft: null,
    ban: null,
    code,
    error: null,
    expiresAt: null,
    intent: "sign_in" as const,
    merge: null,
    merged: false,
    methods: [],
    newAccount: false,
    provider: null,
    restricted: true,
    result: null,
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
