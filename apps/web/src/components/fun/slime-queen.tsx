"use client";

import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Sprite } from "@/components/ui/sprite";
import {
  isWideFinePointer,
  play,
  prefersReducedMotion,
  randomBetween,
  wait,
} from "./motion";

/** Frame 64 px at scale 2. */
const SIZE = 128;
/** Feet sit a few pixels above the bottom of the frame. */
const FEET = 6;
const FIRST_VISIT_MS = 8000;

type Sheet =
  | "slime_queen_walk_6f"
  | "slime_queen_attack2_4f"
  | "slime_queen_attack_4f";

interface Point {
  x: number;
  y: number;
}
interface Splat extends Point {
  id: number;
}
interface Mini extends Point {
  dx: number;
  dy: number;
  id: number;
}

const transformAt = (p: Point) =>
  `translate(${Math.round(p.x - SIZE / 2)}px, ${Math.round(p.y - SIZE + FEET)}px)`;

const clampY = (y: number) =>
  Math.min(window.innerHeight - 24, Math.max(SIZE + 24, y));

/**
 * Easter egg: like in the boss fight, the Slime Queen hops in from a screen edge, follows the
 * mouse with a few hops, jump-attacks the cursor position, leaves a puddle and hops away.
 * Clicking her splits her into mini slimes.
 * Desktop only, never with reduced motion, paused while the tab is hidden.
 */
export function SlimeQueen() {
  const t = useTranslations("common.fun");
  const [active, setActive] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("slime_queen_walk_6f");
  const [flip, setFlip] = useState(false);
  const [splats, setSplats] = useState<Splat[]>([]);
  const [minis, setMinis] = useState<Mini[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const squashRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const pos = useRef<Point>({ x: -SIZE, y: 0 });
  const mouse = useRef<Point>({ x: 0, y: 0 });
  const runRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextId = useRef(0);

  const allowed = useCallback(
    () =>
      isWideFinePointer() &&
      !prefersReducedMotion() &&
      document.visibilityState === "visible",
    []
  );

  const hopTo = useCallback(
    async (
      target: Point,
      height: number,
      duration: number,
      signal: AbortSignal
    ) => {
      const body = bodyRef.current;
      if (!body) {
        return;
      }
      const from = pos.current;
      setFlip(target.x < from.x);
      const top = {
        x: (from.x + target.x) / 2,
        y: Math.min(from.y, target.y) - height,
      };
      await play(
        body.animate(
          [
            { transform: transformAt(from), easing: "ease-out" },
            { transform: transformAt(top), easing: "ease-in" },
            { transform: transformAt(target) },
          ],
          { duration }
        ),
        signal
      );
      pos.current = target;
      body.style.transform = transformAt(target);
      squashRef.current?.animate(
        [{ transform: "scale(1.18, 0.78)" }, { transform: "scale(1, 1)" }],
        { duration: 200, easing: "ease-out" }
      );
    },
    []
  );

  const addSplat = useCallback((p: Point) => {
    nextId.current += 1;
    const id = nextId.current;
    setSplats((list) => [...list, { id, ...p }]);
    window.setTimeout(
      () => setSplats((list) => list.filter((s) => s.id !== id)),
      1800
    );
  }, []);

  const runOnce = useCallback(
    async (signal: AbortSignal) => {
      const body = bodyRef.current;
      if (!body) {
        return;
      }
      const w = window.innerWidth;
      const fromLeft = mouse.current.x > w / 2;
      pos.current = {
        x: fromLeft ? -SIZE / 2 : w + SIZE / 2,
        y: clampY(mouse.current.y + 60),
      };
      body.style.transform = transformAt(pos.current);
      setSheet("slime_queen_walk_6f");

      // Follow the cursor with short hops (one after another), keeping some distance.
      const follow = async (remaining: number): Promise<void> => {
        const dx = mouse.current.x - pos.current.x;
        const dy = clampY(mouse.current.y + 40) - pos.current.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.min(dist - 170, randomBetween(150, 230));
        if (remaining <= 0 || step < 30) {
          return;
        }
        await hopTo(
          {
            x: pos.current.x + (dx / dist) * step,
            y: clampY(pos.current.y + (dy / dist) * step),
          },
          randomBetween(36, 60),
          420,
          signal
        );
        await wait(randomBetween(90, 180), signal);
        return follow(remaining - 1);
      };
      await follow(3 + Math.floor(Math.random() * 3));

      // Jump attack onto the cursor.
      const target = { x: mouse.current.x, y: clampY(mouse.current.y + 24) };
      setSheet("slime_queen_attack2_4f");
      const shadow = shadowRef.current;
      if (shadow) {
        shadow.style.transform = `translate(${target.x - 40}px, ${target.y - 10}px)`;
        shadow.animate(
          [
            { opacity: 0, transform: `${shadow.style.transform} scale(0.3)` },
            { opacity: 0.55, transform: `${shadow.style.transform} scale(1)` },
          ],
          { duration: 650, fill: "forwards" }
        );
      }
      await hopTo(target, 150, 650, signal);
      for (const animation of shadow?.getAnimations() ?? []) {
        animation.cancel();
      }
      setSheet("slime_queen_attack_4f");
      addSplat(target);
      await wait(650, signal);

      // Hop out through the nearest edge.
      setSheet("slime_queen_walk_6f");
      const exitX = pos.current.x < w / 2 ? -SIZE : w + SIZE;
      await hopTo(
        { x: (pos.current.x + exitX) / 2, y: pos.current.y },
        50,
        420,
        signal
      );
      await hopTo({ x: exitX, y: pos.current.y }, 50, 420, signal);
    },
    [addSplat, hopTo]
  );

  const schedule = useCallback(
    (delay: number) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(async () => {
        timerRef.current = null;
        if (!allowed() || runRef.current) {
          schedule(randomBetween(45_000, 60_000));
          return;
        }
        const controller = new AbortController();
        runRef.current = controller;
        setActive(true);
        // Let React mount her before animating.
        await new Promise((r) => window.requestAnimationFrame(r));
        try {
          await runOnce(controller.signal);
        } catch {
          // Aborted: clicked or tab hidden.
        }
        if (runRef.current === controller) {
          runRef.current = null;
          setActive(false);
        }
        schedule(randomBetween(45_000, 60_000));
      }, delay);
    },
    [allowed, runOnce]
  );

  const stop = useCallback(() => {
    runRef.current?.abort();
    runRef.current = null;
    setActive(false);
  }, []);

  const split = useCallback(() => {
    const p = pos.current;
    stop();
    addSplat(p);
    const born = [-1, 0, 1].map((side) => {
      nextId.current += 1;
      return {
        id: nextId.current,
        x: p.x + side * 30,
        y: p.y - 10,
        dx: side * randomBetween(220, 360) || randomBetween(-80, 80),
        dy: side === 0 ? -randomBetween(180, 260) : randomBetween(-120, 120),
      };
    });
    setMinis((list) => [...list, ...born]);
    window.setTimeout(
      () =>
        setMinis((list) =>
          list.filter((m) => !born.some((b) => b.id === m.id))
        ),
      1700
    );
  }, [addSplat, stop]);

  useEffect(() => {
    mouse.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const onMove = (e: PointerEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    schedule(FIRST_VISIT_MS);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      runRef.current?.abort();
    };
  }, [schedule, stop]);

  return (
    <div aria-hidden={active ? undefined : true} className="fun-layer">
      {active ? (
        <>
          <div aria-hidden="true" className="sq-shadow" ref={shadowRef} />
          <div className="sq-body" ref={bodyRef}>
            <div className="sq-squash" ref={squashRef}>
              <button
                aria-label={t("slimeHit")}
                className="sq-hit"
                onClick={split}
                tabIndex={-1}
                type="button"
              >
                <Sprite flip={flip} id={sheet} key={sheet} scale={2} />
              </button>
            </div>
          </div>
        </>
      ) : null}
      {splats.map((s) => (
        <span
          aria-hidden="true"
          className="sq-splat"
          key={s.id}
          style={{ left: s.x, top: s.y } as CSSProperties}
        >
          <Sprite id="toxic_puddle_4f" scale={2} />
          <Sprite className="sq-spark" id="hit_spark_3f" scale={3} />
        </span>
      ))}
      {minis.map((m) => (
        <span
          aria-hidden="true"
          className="sq-mini"
          key={m.id}
          style={
            {
              left: m.x,
              top: m.y,
              "--dx": `${m.dx}px`,
              "--dy": `${m.dy}px`,
            } as CSSProperties
          }
        >
          <span className="sq-mini-hop">
            <Sprite flip={m.dx < 0} id="mini_slime_walk_6f" scale={2} />
          </span>
        </span>
      ))}
    </div>
  );
}
