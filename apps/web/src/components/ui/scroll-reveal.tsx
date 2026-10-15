"use client";

import { type ReactNode, useEffect, useRef } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  /** Viewport margin before the reveal fires. */
  rootMargin?: string;
}

/**
 * Sets `data-revealed` on its wrapper once it scrolls into view. Children opt in with the
 * `reveal` class (and `--reveal-i` for stagger). Without JS or with reduced motion everything
 * is visible from the start.
 */
export function ScrollReveal({
  children,
  className,
  rootMargin = "0px 0px -10% 0px",
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      node.setAttribute("data-revealed", "");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            node.setAttribute("data-revealed", "");
            observer.disconnect();
          }
        }
      },
      { rootMargin, threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div className={className} ref={ref}>
      {children}
    </div>
  );
}
