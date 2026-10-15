import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

/** Display face (OFL), self-hosted from the admin's own copy of the brand package. */
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

export const metadata: Metadata = {
  title: { default: "Soulwick Admin", template: "%s · Soulwick Admin" },
  applicationName: "Soulwick Admin",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/logo_square.svg", type: "image/svg+xml" },
    ],
    apple: [
      {
        url: "/brand/apple-touch-icon.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#1e1b2c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${pixel.variable} ${body.variable}`} lang="de">
      <body>{children}</body>
    </html>
  );
}
