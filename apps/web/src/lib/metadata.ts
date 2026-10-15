import type { Locale } from "@/i18n/locale";

export const SITE_URL = process.env.SITE_URL ?? "https://playsoulwick.com";

export function ogLocale(locale: Locale): string {
  return locale === "de" ? "de_DE" : "en_US";
}
