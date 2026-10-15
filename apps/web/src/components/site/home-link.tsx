"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

interface Props {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Logo link to the landing page. On the landing page itself it scrolls smoothly back to the very
 * top (and drops a `#anchor` from the URL) instead of letting the router jump to `<main>`, which
 * sits below the sticky header.
 */
export function HomeLink({ children, ...rest }: Props) {
  const pathname = usePathname();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname !== "/") {
      return;
    }
    event.preventDefault();
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    if (window.location.hash) {
      window.history.replaceState(null, "", "/");
    }
  }

  return (
    <Link {...rest} href="/" onClick={handleClick} scroll={false}>
      {children}
    </Link>
  );
}
