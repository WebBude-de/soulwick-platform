import "server-only";
import { cookies } from "next/headers";

/**
 * httpOnly cookie holding the admin session token (Better Auth, P-027). Only server code reads
 * it; client JS never sees it. It expires together with the session (`expiresAt` of the login).
 */
export const SESSION_COOKIE = "soulwick_admin";

/**
 * Marker without any secret ("1"): set at login, removed at logout, outlives the session cookie.
 * When the session cookie is gone but the marker is still there, the session ran out, so the
 * proxy sends the visitor to the login page with the "Sitzung abgelaufen" hint.
 */
export const SEEN_COOKIE = "soulwick_admin_seen";
const SEEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Secure in production unless explicitly disabled (e.g. a production build over plain http).
const secure = () =>
  process.env.NODE_ENV === "production" &&
  process.env.ADMIN_COOKIE_SECURE !== "false";

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Stores the session token until `expiresAt` (falls back to a browser-session cookie). */
export async function setSession(
  token: string,
  expiresAt: string
): Promise<void> {
  const store = await cookies();
  const expires = new Date(expiresAt);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: secure(),
    path: "/",
    ...(Number.isNaN(expires.getTime()) ? {} : { expires }),
  });
  store.set(SEEN_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: "/",
    maxAge: SEEN_MAX_AGE_SECONDS,
  });
}

/** Removes the session cookie and the marker (logout). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(SEEN_COOKIE);
}
