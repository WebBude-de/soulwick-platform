import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { FunLayer } from "@/components/fun/fun-layer";
import { ScrollToTop } from "@/components/site/scroll-to-top";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import type { Locale } from "@/i18n/locale";
import { brand } from "@/lib/brand";
import { ogLocale, SITE_URL } from "@/lib/metadata";
import "./globals.css";
import "@/components/fun/fun.css";

/** Display face from the delivered package (OFL), self-hosted. */
const pixel = localFont({
  src: "../../public/brand/fonts/PixelifySans-Variable.ttf",
  weight: "400 700",
  variable: "--font-pixelify",
  display: "swap",
});

const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

interface Props {
  children: ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const safeLocale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale: safeLocale, namespace: "common" });
  const ogImage = brand.ogImage();

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
      locale: ogLocale(safeLocale),
      title: `${t("siteName")} – ${t("tagline")}`,
      description: t("description"),
      images: ogImage
        ? [{ url: ogImage, width: 1200, height: 632 }]
        : undefined,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
    },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: Props) {
  const locale = await getLocale();

  return (
    <html className={`${pixel.variable} ${body.variable}`} lang={locale}>
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
