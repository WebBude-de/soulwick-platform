import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { FunLayer } from "@/components/fun/fun-layer";
import { ScrollToTop } from "@/components/site/scroll-to-top";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { isLocale, LOCALES, type Locale } from "@/i18n/locale";
import { brand } from "@/lib/brand";
import { ogLocale, SITE_URL } from "@/lib/metadata";
import { fontVariables } from "../fonts";
import "../globals.css";
import "@/components/fun/fun.css";
import "@/components/wick/wick.css";

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * The language is a hidden route segment: the URLs never show it (P-012), `src/proxy.ts`
 * rewrites every page request to `/<locale>/…` after reading the `NEXT_LOCALE` cookie (else
 * `Accept-Language`, else English). That lets pages without per-request data, like the news,
 * be generated once per language at build time.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

async function pageLocale(params: Props["params"]): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  return locale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale(params);
  const t = await getTranslations({ locale, namespace: "common" });
  const ogImage = brand.ogImage(locale);

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: `${t("siteName")} – ${t("tagline")}`,
      template: `%s · ${t("siteName")}`,
    },
    description: t("description"),
    applicationName: t("siteName"),
    icons: {
      icon: [
        { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/logo_square.svg", type: "image/svg+xml" },
      ],
    },
    openGraph: {
      type: "website",
      siteName: t("siteName"),
      locale: ogLocale(locale),
      title: `${t("siteName")} – ${t("tagline")}`,
      description: t("description"),
      images: ogImage
        ? [{ url: ogImage.src, width: ogImage.width, height: ogImage.height }]
        : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
    },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children, params }: Props) {
  const locale = await pageLocale(params);

  return (
    <html className={fontVariables} lang={locale}>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider>
          <SiteHeader />
          <main className="flex-1" id="inhalt">
            {children}
          </main>
          <SiteFooter />
          <FunLayer />
          <ScrollToTop />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
