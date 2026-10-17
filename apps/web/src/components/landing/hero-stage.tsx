"use client";

import { type ReactNode, useEffect, useRef } from "react";

/** Where Wick rests and wanders (feet, in % of the stage). The first point is home. */
const WANDER: [number, number][] = [
  [50, 52],
  [20, 50],
  [48, 60],
  [86, 50],
  [74, 88],
  [36, 90],
];
const HOME = WANDER[0] as [number, number];
/** Wick never flies into the wall or out of the picture. */
const BOUNDS = { x: [18, 94], y: [36, 96] } as const;
/** Beside the copy Wick may fly left over the headline, up to this far (px) from the hero's edge. */
const EDGE_PX = 40;
/** After the last pointer input Wick waits this long before wandering again. */
const IDLE_MS = 4000;
const WANDER_MS = 3200;
/** Share of the remaining way Wick covers per frame (soft follow). */
const EASE = 0.085;

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, value));

interface HeroStageProps {
  children: ReactNode;
  className?: string;
}

/**
 * The hero's dark dungeon. Wick (and the light around it) follows the mouse, flies to a tapped
 * spot on touch screens and wanders between the friends and the lurking monsters when nobody
 * plays with it. The whole hero listens: where the dungeon sits beside the copy (wide screens),
 * Wick follows on over the headline instead of jumping home. Writes `--wx`/`--wy` (Wick's feet
 * in px), `--tilt` and `data-facing` on the stage; CSS does the rest. Nothing moves under
 * `prefers-reduced-motion`, and the loop sleeps while the stage is off screen.
 */
export function HeroStage({ children, className }: HeroStageProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = ref.current;
    const hero = stage?.parentElement;
    if (
      !(stage && hero) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let width = stage.clientWidth;
    let height = stage.clientHeight;
    const pos = { x: (width * HOME[0]) / 100, y: (height * HOME[1]) / 100 };
    let target = { ...pos };
    let raf = 0;
    let visible = true;
    let lastInput = 0;
    let wanderIndex = 0;
    /** The mouse is in the play area (dungeon, or the headline beside it). */
    let inside = false;

    const write = (tilt: number) => {
      stage.style.setProperty("--wx", `${pos.x.toFixed(1)}px`);
      stage.style.setProperty("--wy", `${pos.y.toFixed(1)}px`);
      stage.style.setProperty("--tilt", `${tilt.toFixed(1)}deg`);
    };

    const tick = () => {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      pos.x += dx * EASE;
      pos.y += dy * EASE;
      if (Math.abs(dx) > 2) {
        stage.dataset.facing = dx < 0 ? "left" : "right";
      }
      const moving = Math.hypot(dx, dy) > 0.6;
      write(moving ? clamp(dx * 0.12, [-14, 14]) : 0);
      raf = moving && visible ? requestAnimationFrame(tick) : 0;
    };

    const moveTo = (xPct: number, yPct: number, minX: number = BOUNDS.x[0]) => {
      target = {
        x: (width * clamp(xPct, [minX, BOUNDS.x[1]])) / 100,
        y: (height * clamp(yPct, BOUNDS.y)) / 100,
      };
      if (!raf && visible) {
        raf = requestAnimationFrame(tick);
      }
    };

    /** Pointer as Wick's target (% of the stage) and left bound, `null` outside the play area. */
    const fromEvent = (
      event: PointerEvent
    ): [x: number, y: number, minX: number] | null => {
      const rect = stage.getBoundingClientRect();
      // Stacked layout: the stage starts at the hero's edge and the copy sits below it.
      const edge = hero.getBoundingClientRect().left;
      if (
        event.clientX < edge ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return null;
      }
      return [
        ((event.clientX - rect.left) / rect.width) * 100,
        // The pointer is the light: aim Wick's feet a little below it.
        ((event.clientY - rect.top) / rect.height) * 100 + 8,
        rect.left > edge
          ? ((edge + EDGE_PX - rect.left) / rect.width) * 100
          : BOUNDS.x[0],
      ];
    };

    const goHome = () => {
      inside = false;
      lastInput = Date.now();
      moveTo(...HOME);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      const spot = fromEvent(event);
      if (spot) {
        inside = true;
        lastInput = Date.now();
        moveTo(...spot);
      } else if (inside) {
        goHome();
      }
    };
    const onDown = (event: PointerEvent) => {
      const spot = fromEvent(event);
      if (spot) {
        lastInput = Date.now();
        moveTo(...spot);
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && inside) {
        goHome();
      }
    };

    const wander = window.setInterval(() => {
      if (!visible || Date.now() - lastInput < IDLE_MS) {
        return;
      }
      wanderIndex = (wanderIndex + 1) % WANDER.length;
      const point = WANDER[wanderIndex] ?? HOME;
      moveTo(point[0], point[1]);
    }, WANDER_MS);

    const resize = new ResizeObserver(() => {
      const nextWidth = stage.clientWidth;
      const nextHeight = stage.clientHeight;
      if (width > 0 && height > 0) {
        pos.x *= nextWidth / width;
        pos.y *= nextHeight / height;
        target.x *= nextWidth / width;
        target.y *= nextHeight / height;
      }
      width = nextWidth;
      height = nextHeight;
      write(0);
    });
    resize.observe(stage);

    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !raf) {
        raf = requestAnimationFrame(tick);
      }
    });
    seen.observe(stage);

    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerdown", onDown);
    hero.addEventListener("pointerleave", onLeave);
    stage.dataset.live = "";
    write(0);

    return () => {
      window.clearInterval(wander);
      resize.disconnect();
      seen.disconnect();
      cancelAnimationFrame(raf);
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerdown", onDown);
      hero.removeEventListener("pointerleave", onLeave);
      delete stage.dataset.live;
    };
  }, []);

  return (
    <div className={className} data-facing="right" ref={ref}>
      {children}
    </div>
  );
}
