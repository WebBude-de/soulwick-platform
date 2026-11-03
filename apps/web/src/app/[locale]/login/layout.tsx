import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Login pages (KF11): never indexed, and no referrer leaves them (the URL may carry the
 * one-time `?confirm=` secret or a magic link token). `src/proxy.ts` also sends the header.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
