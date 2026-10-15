"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * After a route change (e.g. leaderboards → landing page) start at the very top of the page. The
 * router would otherwise scroll `<main>` into view, which leaves it a header height below the top.
 * Links with a `#anchor` keep their anchor target.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname && !window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [pathname]);

  return null;
}
