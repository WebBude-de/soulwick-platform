"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Sprite } from "@/components/ui/sprite";
import { pick } from "./motion";

const PANIC_CLICKS = 5;
const PANIC_MS = 20_000;
const TALK_MS = 1400;

interface ChickenProps {
  className?: string;
  /** Stands and pecks instead of walking (the key art frame). */
  idle?: boolean;
  scale?: number;
}

/**
 * Easter egg chicken (footer and village): hover or tap → it stops, flaps and clucks;
 * five clicks → it panics, runs off and comes back after 20 s.
 */
export function Chicken({ scale = 2, className, idle }: ChickenProps) {
  const t = useTranslations("common.fun");
  const [talk, setTalk] = useState<string | null>(null);
  const [panic, setPanic] = useState(false);
  const clicks = useRef(0);
  const talkTimer = useRef<number | null>(null);
  const panicTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      for (const timer of [talkTimer.current, panicTimer.current]) {
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      }
    },
    []
  );

  const speak = (text?: string) => {
    setTalk(text ?? pick(t.raw("chickenSays") as string[]) ?? "!");
    if (talkTimer.current !== null) {
      window.clearTimeout(talkTimer.current);
    }
    talkTimer.current = window.setTimeout(() => setTalk(null), TALK_MS);
  };

  const onClick = () => {
    if (panic) {
      return;
    }
    clicks.current += 1;
    if (clicks.current < PANIC_CLICKS) {
      speak();
      return;
    }
    clicks.current = 0;
    speak(t("chickenPanic"));
    setPanic(true);
    panicTimer.current = window.setTimeout(() => setPanic(false), PANIC_MS);
  };

  return (
    <button
      aria-label={t("chickenLabel")}
      className={["chicken", className].filter(Boolean).join(" ")}
      data-panic={panic ? "" : undefined}
      data-talk={talk ? "" : undefined}
      onClick={onClick}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse" && !panic) {
          speak();
        }
      }}
      type="button"
    >
      <span className="chicken-body">
        <Sprite
          id={(talk || idle) && !panic ? "chicken_idle_4f" : "chicken_walk_4f"}
          scale={scale}
        />
      </span>
      {talk ? (
        <span aria-live="polite" className="chicken-bubble">
          {talk}
        </span>
      ) : null}
    </button>
  );
}
