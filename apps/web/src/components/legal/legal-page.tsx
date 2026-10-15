import type { LegalDocumentResponse } from "@soulwick/contracts";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import type { Locale } from "@/i18n/locale";
import type { ApiResult } from "@/lib/api";
import { resolveLegalView } from "@/lib/legal";
import { LegalHtml } from "./legal-html";

type LegalKind = "imprint" | "privacy";

const FACT_KEYS = {
  imprint: ["project", "contact", "noShop"],
  privacy: ["offline", "stored", "notStored", "website", "deletion"],
} as const;

/**
 * Imprint or privacy policy: the HTML from the API when it is ready, otherwise an honest
 * placeholder with the facts that are already certain. Never invents names or addresses.
 */
export function LegalPage({
  kind,
  locale,
  result,
}: {
  kind: LegalKind;
  locale: Locale;
  result: ApiResult<LegalDocumentResponse>;
}) {
  const t = useTranslations("legal");
  const format = useFormatter();
  const view = resolveLegalView(result, locale);

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl text-gold sm:text-4xl">{t(`${kind}.title`)}</h1>
        {view.state === "ready" && view.modifiedAt ? (
          <p className="font-pixel text-muted">
            {t("modified", {
              date: format.dateTime(new Date(view.modifiedAt), {
                dateStyle: "long",
              }),
            })}
          </p>
        ) : null}
      </header>

      {view.state === "ready" ? (
        <>
          {view.fallback ? (
            <PixelPanel className="px-4 py-3 text-soft" variant="gold">
              <p className="flex items-center gap-3">
                <Sprite id="icon_info" scale={2} />
                <span>{t("otherLocale.note")}</span>
              </p>
            </PixelPanel>
          ) : null}
          <LegalHtml
            html={view.html}
            lang={view.fallback ? view.htmlLocale : undefined}
          />
        </>
      ) : (
        <Placeholder kind={kind} reason={view.reason} />
      )}
    </article>
  );
}

function Placeholder({
  kind,
  reason,
}: {
  kind: LegalKind;
  reason: "missing" | "unreachable";
}) {
  const t = useTranslations("legal");
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PixelPanel className="p-5 sm:p-6" variant="gold">
        <div className="flex items-start gap-4">
          <Sprite className="mt-1" id="icon_lock" scale={3} />
          <div className="flex flex-col gap-2">
            <h2 className="text-gold text-xl sm:text-2xl">
              {t(`${kind}.placeholderTitle`)}
            </h2>
            <p className="text-soft">
              {reason === "unreachable"
                ? t("placeholder.unreachable")
                : t("placeholder.text")}
            </p>
          </div>
        </div>
      </PixelPanel>

      <section
        aria-labelledby="legal-quick-facts"
        className="flex flex-col gap-4"
      >
        <h2 className="text-gold text-xl sm:text-2xl" id="legal-quick-facts">
          {t("quickFacts.title")}
        </h2>
        <ul className="flex flex-col gap-3">
          {FACT_KEYS[kind].map((key) => (
            <li className="flex items-start gap-3 text-soft" key={key}>
              <Sprite className="mt-1" id="crystal_icon" scale={2} />
              <span>{factText(t, kind, key)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations<"legal">>;

/** Keeps the two fact lists typed without a union of every key in one template string. */
function factText(t: Translate, kind: LegalKind, key: string): ReactNode {
  if (kind === "imprint") {
    return t(`imprint.facts.${key as (typeof FACT_KEYS.imprint)[number]}`);
  }
  if (key === "deletion") {
    return t.rich("privacy.facts.deletion", {
      link: (chunks) => (
        <Link
          className="text-violet-link underline hover:text-gold"
          href="/delete-account"
        >
          {chunks}
        </Link>
      ),
    });
  }
  return t(`privacy.facts.${key as (typeof FACT_KEYS.privacy)[number]}`);
}
