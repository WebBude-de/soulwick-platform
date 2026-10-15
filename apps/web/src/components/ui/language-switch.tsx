"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useTransition } from "react";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  type Locale,
} from "@/i18n/locale";

interface LanguageSwitchProps {
  className?: string;
  /** Larger segment buttons (44 px) for the phone menu. */
  touch?: boolean;
  /** `segment` = pixel segment control (navbar), `text` = „Deutsch · English“ (footer). */
  variant?: "segment" | "text";
}

function writeCookie(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: the server reads the language from this cookie; the Cookie Store API is not available in every browser.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage unavailable (private mode): the cookie alone still carries the choice.
  }
}

/**
 * Language switch without language in the URL: sets the `NEXT_LOCALE` cookie, mirrors the choice
 * into localStorage and re-renders the current page on the server (`router.refresh()`).
 */
export function LanguageSwitch({
  variant = "segment",
  className,
  touch,
}: LanguageSwitchProps) {
  const t = useTranslations("common.language");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // A choice stored in this browser wins over the server's guess (e.g. after the cookie expired).
  useEffect(() => {
    const stored = readStored();
    if (isLocale(stored) && stored !== locale) {
      writeCookie(stored);
      router.refresh();
    }
  }, [locale, router]);

  const choose = (target: Locale) => {
    if (target === locale) {
      return;
    }
    writeCookie(target);
    store(target);
    startTransition(() => router.refresh());
  };

  if (variant === "text") {
    return (
      <fieldset
        className={["m-0 border-0 p-0", className].filter(Boolean).join(" ")}
      >
        <legend className="sr-only">{t("label")}</legend>
        <ul className="flex items-center gap-2 text-[13px]">
          {LOCALES.map((target, index) => (
            <li className="flex items-center gap-2" key={target}>
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <button
                aria-pressed={target === locale}
                className={[
                  "inline-flex min-h-11 items-center px-1 md:min-h-8",
                  target === locale
                    ? "text-text"
                    : "text-muted hover:text-gold",
                ].join(" ")}
                disabled={pending}
                lang={target}
                onClick={() => choose(target)}
                type="button"
              >
                {t(target)}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
    );
  }

  return (
    <fieldset
      className={["m-0 border-0 p-0", className].filter(Boolean).join(" ")}
    >
      <legend className="sr-only">{t("label")}</legend>
      <ul className="lb-seg">
        {LOCALES.toSorted((a) => (a === "de" ? -1 : 1)).map((target) => {
          const active = target === locale;
          return (
            <li className="flex" key={target}>
              <button
                aria-pressed={active}
                className={[
                  "inline-flex items-center font-pixel text-[14px] leading-none",
                  touch ? "min-h-11" : "min-h-9",
                  active
                    ? "bg-gold text-ink text-shadow-none"
                    : "text-soft hover:text-gold",
                ].join(" ")}
                disabled={pending}
                lang={target}
                onClick={() => choose(target)}
                style={{ fontWeight: 400 }}
                title={t(target)}
                type="button"
              >
                <span aria-hidden="true">{t(`short.${target}`)}</span>
                <span className="sr-only">{t(target)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
