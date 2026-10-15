"use client";

import { useEffect, useRef } from "react";
import { Sprite } from "@/components/ui/sprite";
import { prefersReducedMotion } from "./motion";

/** Must match `::-webkit-scrollbar-thumb { min-height }` in globals.css. */
const MIN_THUMB = 48;
const MAX_SWING = 26;

/**
 * Easter egg: the village cat hangs on the scrollbar thumb. It follows the thumb (computed from
 * the scroll ratio; the pixel scrollbar has no arrow buttons), swings when you scroll fast and
 * settles when you stop. Only with a fine pointer and a visible scrollbar; static with reduced
 * motion. Decorative, never clickable.
 */
export function ScrollCat() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const reduce = prefersReducedMotion();
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let settle: number | null = null;
    let lastY = window.scrollY;
    let lastT = performance.now();

    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const barWidth = window.innerWidth - doc.clientWidth;
      const viewport = doc.clientHeight;
      const total = doc.scrollHeight;
      const show = fine.matches && barWidth > 0 && total > viewport + 1;
      el.toggleAttribute("data-show", show);
      if (!show) {
        return;
      }
      const thumb = Math.max(MIN_THUMB, (viewport * viewport) / total);
      const ratio = window.scrollY / Math.max(1, total - viewport);
      el.style.setProperty("--bar", `${barWidth}px`);
      el.style.setProperty(
        "--thumb-top",
        `${Math.round(ratio * (viewport - thumb))}px`
      );
      if (reduce) {
        return;
      }
      const now = performance.now();
      const velocity = (window.scrollY - lastY) / Math.max(16, now - lastT);
      lastY = window.scrollY;
      lastT = now;
      // Inertia: the thumb drags the cat by its paws, so the body lags behind. Scrolling down
      // moves the thumb down and lifts the body up (clockwise around the paws on the right edge);
      // scrolling up lets it hang down and swing out the other way.
      const swing = Math.max(-MAX_SWING, Math.min(MAX_SWING, velocity * 12));
      el.style.setProperty("--swing", `${swing.toFixed(1)}deg`);
      if (settle !== null) {
        window.clearTimeout(settle);
      }
      settle = window.setTimeout(
        () => el.style.setProperty("--swing", "0deg"),
        140
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      if (settle !== null) {
        window.clearTimeout(settle);
      }
    };
  }, []);

  return (
    <div aria-hidden="true" className="scroll-cat" ref={ref}>
      <div className="scroll-cat-swing">
        <span className="scroll-cat-paw scroll-cat-paw-a" />
        <span className="scroll-cat-paw scroll-cat-paw-b" />
        <Sprite className="scroll-cat-body" id="cat_idle_4f" scale={3} />
      </div>
    </div>
  );
}
