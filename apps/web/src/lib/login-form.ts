/**
 * Field names, action states and error keys shared by the login pages, their client components
 * and Server Actions (KF11). Safe for client components (no server code).
 */
import type { LoginState } from "@/lib/login-protocol";

export const CODE_FIELD = "code";
export const CONFIRM_FIELD = "confirmSecret";
export const EMAIL_FIELD = "email";
export const LOCALE_FIELD = "locale";
export const TOKEN_FIELD = "token";
export const TYPED_CODE_FIELD = "typedCode";

/** Invisible bot trap of the e-mail form; people never see or fill it. */
export const HONEYPOT_FIELD = "website";

/** Six characters plus room for the spaces or dashes people type to group them ("ABC-DEF"). */
export const TYPED_CODE_MAX = 10;

export type MailNotice =
  | "invalid"
  | "rate_limited"
  | "not_configured"
  | "unreachable"
  | "closed";

export type MailState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; notice: MailNotice; email: string };

export type ConfirmNotice =
  | "format"
  | "wrong_code"
  | "rate_limited"
  | "unreachable";

export type ConfirmState =
  | { status: "idle" }
  | { status: "done"; state: LoginState }
  | {
      status: "error";
      notice: ConfirmNotice;
      attemptsLeft: number | null;
    };

/**
 * Error codes the login pages explain in their own words (`messages/<locale>/login.json`
 * `errors.<key>`); the API may add more, those read as `generic`.
 */
export const LOGIN_ERRORS = [
  "web_login_not_found",
  "web_login_claimed",
  "web_login_not_pending",
  "expired",
  "too_many_attempts",
  "invalid_state",
  "provider_not_configured",
  "cancelled",
  "provider_error",
  "invalid_login",
  "banned",
  "merge_blocked_banned",
  "account_gone",
  "email_unavailable",
  "invalid_magic_link",
  "rate_limited",
  "unreachable",
  "generic",
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/** Several API codes read the same for a player. */
const ALIASES: Partial<Record<string, LoginError>> = {
  provider_unavailable: "provider_error",
  steam_unavailable: "provider_error",
  invalid_oauth_code: "invalid_login",
  invalid_steam_openid: "invalid_login",
  invalid_apple_token: "invalid_login",
  web_login_not_confirmable: "web_login_not_pending",
  confirm_attempts_exceeded: "too_many_attempts",
};

export function loginError(code: string | null | undefined): LoginError {
  if (!code) {
    return "generic";
  }
  if ((LOGIN_ERRORS as readonly string[]).includes(code)) {
    return code as LoginError;
  }
  return ALIASES[code] ?? "generic";
}
