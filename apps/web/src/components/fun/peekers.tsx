"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";
import {
  isWideFinePointer,
  pick,
  prefersReducedMotion,
  randomBetween,
} from "./motion";

const PEEKERS: { id: SpriteId; scale: number }[] = [
  { id: "skeleton_idle_4f", scale: 3 },
  { id: "cat_idle_4f", scale: 4 },
  { id: "archer_idle_4f", scale: 3 },
];

/** At most one peek every ~20 s. */
const GAP_MS = 20_000;

interface Peek {
  id: SpriteId;
  key: number;
  scale: number;
  side: "left" | "right";
  top: number;
}

/**
 * Easter egg: while scrolling, a game sprite peeks in from the left or right viewport edge
 * for a moment and hides again. Decorative, desktop only, nothing with reduced motion.
 */
export function Peekers() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const last = useRef(0);

  useEffect(() => {
    // The first peek may come a few seconds into scrolling, then every ~20 s at most.
    last.current = Date.now() - GAP_MS + 6000;
    let key = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - last.current < GAP_MS || Math.random() > 0.08) {
        return;
      }
      if (!isWideFinePointer() || prefersReducedMotion()) {
        return;
      }
      const choice = pick(PEEKERS);
      if (!choice) {
        return;
      }
      last.current = now;
      key += 1;
      setPeek({
        key,
        ...choice,
        side: Math.random() < 0.5 ? "left" : "right",
        top: randomBetween(25, 70),
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!peek) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={`peeker peeker-${peek.side}`}
      key={peek.key}
      onAnimationEnd={() => setPeek(null)}
      style={{ top: `${peek.top}vh` } as CSSProperties}
    >
      <Sprite flip={peek.side === "right"} id={peek.id} scale={peek.scale} />
    </span>
  );
}
