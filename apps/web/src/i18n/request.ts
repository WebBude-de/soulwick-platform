import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  isLocale,
  LOCALE_COOKIE,
  type Locale,
  localeFromAcceptLanguage,
} from "./locale";
import { getMessages } from "./messages";

/** next-intl without i18n routing: cookie `NEXT_LOCALE` → `Accept-Language` → English. */
export async function resolveLocale(): Promise<Locale> {
  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieValue)) {
    return cookieValue;
  }
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: getMessages(locale),
    timeZone: "Europe/Berlin",
  };
});
