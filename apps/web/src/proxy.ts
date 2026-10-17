import { type NextRequest, NextResponse } from "next/server";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
  localeFromAcceptLanguage,
} from "./i18n/locale";

/**
 * The URLs carry no language (P-012), the pages live under a hidden `[locale]` segment:
 * - Every page request is rewritten to `/<locale>/<path>`: cookie `NEXT_LOCALE`, else
 *   `Accept-Language`, else English. The address bar keeps the plain path. Pages without
 *   per-request data (the news) are therefore built once per language ahead of time.
 * - Old links with a language prefix (`/de/ranglisten`, `/en/leaderboards`, …) are redirected
 *   permanently to the plain English path, and the prefix language is stored in the cookie so
 *   the visitor keeps reading in that language. This also keeps `/de/…` from being a second
 *   address for the same page.
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

function redirectPrefixed(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
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

/** Same order as `resolveLocale` in `src/i18n/request.ts`. */
export function requestLocale(request: NextRequest): Locale {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) {
    return cookie;
  }
  return localeFromAcceptLanguage(request.headers.get("accept-language"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PREFIX.test(pathname)) {
    return redirectPrefixed(request);
  }
  const url = request.nextUrl.clone();
  url.pathname = `/${requestLocale(request)}${pathname === "/" ? "" : pathname}`;
  const response = NextResponse.rewrite(url);
  // One address, two languages: shared caches must not hand one visitor's language to another.
  response.headers.set("Vary", "Cookie, Accept-Language");
  return response;
}

export const config = {
  // Pages only: no build assets, no files (`/brand/…`, `robots.txt`, `sitemap.xml`).
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
