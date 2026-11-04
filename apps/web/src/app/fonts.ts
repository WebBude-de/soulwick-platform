import localFont from "next/font/local";

/**
 * The two faces of the site, shared by the root layout (`[locale]/layout.tsx`) and the global
 * 404 (`global-not-found.tsx`), which renders without that layout.
 */

/** Display face from the delivered package (OFL), self-hosted. */
export const pixel = localFont({
  src: "../../public/brand/fonts/PixelifySans-Variable.ttf",
  weight: "400 700",
  variable: "--font-pixelify",
  display: "swap",
});

/**
 * Body face (OFL), self-hosted: next/font/google breaks on Google's `/l/font?kit=` URLs ("queries have
 * exactly one entry") in dev and in the Docker build, and local files need no request to Google.
 */
export const body = localFont({
  src: "../../public/brand/fonts/DMSans-Variable.ttf",
  weight: "100 1000",
  variable: "--font-dm-sans",
  display: "swap",
});

/** Class names for `<html>` that expose both faces as CSS variables. */
export const fontVariables = `${pixel.variable} ${body.variable}`;
