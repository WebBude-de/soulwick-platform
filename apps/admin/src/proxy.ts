import { type NextRequest, NextResponse } from "next/server";

// Keep in sync with lib/session.ts (proxy must not import server-only modules).
const SESSION_COOKIE = "soulwick_admin";
const SEEN_COOKIE = "soulwick_admin_seen";

/**
 * Cheap pre-check only: sends visitors without a session cookie to the login page (with the
 * "Sitzung abgelaufen" hint when the cookie ran out). The API validates the token itself.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const login = new URL("/login", request.url);
  if (request.cookies.has(SEEN_COOKIE)) {
    login.searchParams.set("abgelaufen", "1");
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Brand assets (favicon, logo, icons) are public so the login page can show them.
  matcher: ["/((?!login|_next/|brand/|favicon.ico).*)"],
};
