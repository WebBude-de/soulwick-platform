import { type NextRequest, NextResponse } from "next/server";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "./i18n/locale";

/**
 * The URLs carry no language. Old links with a language prefix (`/de/ranglisten`,
 * `/en/leaderboards`, …) are redirected permanently to the plain English path, and the prefix
 * language is stored in the locale cookie so the visitor keeps reading in that language.
 */
const SLUGS: Partial<Record<string, string>> = {
  ranglisten: "leaderboards",
  gilden: "guilds",
  datenschutz: "privacy",
  impressum: "imprint",
  spiel: "",
  game: "",
};

const PREFIX = /^\/(de|en)(?=\/|$)/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!PREFIX.test(pathname)) {
    return NextResponse.next();
  }
  const locale: Locale = pathname.startsWith("/de") ? "de" : "en";
  // Everything after the three-character prefix (`/de` or `/en`).
  const [first = "", ...rest] = pathname.slice(3).split("/").filter(Boolean);
  const mapped = SLUGS[first] ?? first;
  const target = `/${[mapped, ...rest].filter(Boolean).join("/")}`;

  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = search;
  const response = NextResponse.redirect(url, 308);
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/de", "/de/:path*", "/en", "/en/:path*"],
};
