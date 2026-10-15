/**
 * Supported languages. The URL never contains the language: English is the default, German
 * visitors get German via the `NEXT_LOCALE` cookie or their `Accept-Language` header.
 */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie read on the server (also next-intl's default name). */
export const LOCALE_COOKIE = "NEXT_LOCALE";
/** Mirror of the visitor's choice in the browser, restored if the cookie is lost. */
export const LOCALE_STORAGE_KEY = "soulwick.locale";
/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/** German if the browser lists German before English, otherwise English. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) {
    return DEFAULT_LOCALE;
  }
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return {
        lang: tag.toLowerCase().slice(0, 2),
        q: q ? Number(q.split("=")[1]) : 1,
      };
    })
    .filter((entry) => entry.lang && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);
  const first = ranked.find((entry) => isLocale(entry.lang));
  return first ? (first.lang as Locale) : DEFAULT_LOCALE;
}
