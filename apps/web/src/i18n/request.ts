import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { getRequestConfig } from "next-intl/server";
import {
  isLocale,
  LOCALE_COOKIE,
  type Locale,
  localeFromAcceptLanguage,
} from "./locale";
import { getMessages } from "./messages";

/**
 * Language of a request without a language segment (Server Actions, route handlers): cookie
 * `NEXT_LOCALE` → `Accept-Language` → English. `src/proxy.ts` picks the segment the same way.
 */
export async function resolveLocale(): Promise<Locale> {
  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieValue)) {
    return cookieValue;
  }
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

/**
 * The language of the page being rendered: the hidden `[locale]` segment (root param). Reading
 * it keeps pages static where they can be (news); only where there is no segment do cookie and
 * header decide.
 */
async function currentLocale(): Promise<Locale> {
  try {
    const segment = await rootLocale();
    if (isLocale(segment)) {
      return segment;
    }
  } catch (error) {
    // Root params exist only while rendering pages and layouts; elsewhere fall back below.
    unstable_rethrow(error);
  }
  return resolveLocale();
}

/** next-intl without its routing: an explicit `locale` (e.g. `getTranslations({ locale })`) wins. */
export default getRequestConfig(async ({ locale: explicit }) => {
  const locale = isLocale(explicit) ? explicit : await currentLocale();
  return {
    locale,
    messages: getMessages(locale),
    timeZone: "Europe/Berlin",
  };
});
