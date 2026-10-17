import type { Metadata } from "next";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import { getMessages } from "@/i18n/messages";
import { fontVariables } from "./fonts";
import "./globals.css";

const copy = getMessages(DEFAULT_LOCALE).common;

export const metadata: Metadata = {
  title: `${copy.notFound.title} · ${copy.siteName}`,
};

/**
 * Last-resort 404 for URLs that never reach the language segment (`[locale]`), e.g. a file
 * path the proxy leaves alone. Everything else gets the localized `[locale]/not-found.tsx`
 * with header and footer. Renders without the root layout, hence its own document and fonts.
 */
export default function GlobalNotFound() {
  return (
    <html className={fontVariables} lang={DEFAULT_LOCALE}>
      <body className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        {/* biome-ignore lint/performance/noImgElement: crisp-edges SVG wordmark, no optimisation needed. */}
        <img
          alt={copy.siteName}
          height={36}
          src="/brand/logo.svg"
          width={120}
        />
        <p className="font-pixel text-disabled text-lg">404</p>
        <h1 className="text-3xl text-gold sm:text-4xl">
          {copy.notFound.title}
        </h1>
        {/* Plain link: this page sits outside the app router tree. */}
        <a className="btn btn-primary" href="/">
          {copy.notFound.back}
        </a>
      </body>
    </html>
  );
}
