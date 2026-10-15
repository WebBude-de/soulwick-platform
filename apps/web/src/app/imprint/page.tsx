import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import type { Locale } from "@/i18n/locale";
import { getLegalDocument } from "@/lib/legal";

/** Rendered per request; the API response itself is cached for 300 s (see `getLegalDocument`). */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return {
    title: t("imprint.title"),
    description: t("imprint.description"),
    alternates: { canonical: "/imprint" },
    robots: { index: false, follow: true },
  };
}

export default async function ImprintRoute() {
  const locale = (await getLocale()) as Locale;
  const result = await getLegalDocument("imprint");
  return (
    <div className="container-site py-10 sm:py-14">
      <LegalPage kind="imprint" locale={locale} result={result} />
    </div>
  );
}
