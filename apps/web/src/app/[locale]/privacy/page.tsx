import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import type { Locale } from "@/i18n/locale";
import { getLegalDocument, resolveLegalView } from "@/lib/legal";
import { withLegalFileFallback } from "@/lib/legal-files";
import { loadSupportEmail } from "@/lib/support";

/**
 * Rendered per request; the API response itself is cached for 300 s (see `getLegalDocument`).
 * Without a text from the API, `content/legal/privacy.<locale>.html` is shown if it exists.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return {
    title: t("privacy.title"),
    description: t("privacy.description"),
    alternates: { canonical: "/privacy" },
    robots: { index: false, follow: true },
  };
}

export default async function PrivacyRoute() {
  const locale = (await getLocale()) as Locale;
  const [result, supportEmail] = await Promise.all([
    getLegalDocument("privacy-policy"),
    loadSupportEmail(),
  ]);
  const view = await withLegalFileFallback(
    resolveLegalView(result, locale),
    "privacy",
    locale
  );
  return (
    <div className="container-site py-10 sm:py-14">
      <LegalPage kind="privacy" supportEmail={supportEmail} view={view} />
    </div>
  );
}
