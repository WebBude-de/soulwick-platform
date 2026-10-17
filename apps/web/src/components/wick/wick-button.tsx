"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { pick } from "@/components/fun/motion";
import { WickFigure } from "./wick-figure";

const HOP_MS = 600;
const TALK_MS = 1600;

interface WickButtonProps {
  className?: string;
  /** Large illustration (`brand.wick().hero`); shown instead of the figure when present. */
  heroSrc?: string | null;
  scale: number | string;
  /** Idle strip (`brand.wick().idle`); `null` draws the placeholder. */
  src: string | null;
}

/** Wick as a button: a tap or click makes it hop, flare up and say hello. */
export function WickButton({
  src,
  heroSrc,
  scale,
  className,
}: WickButtonProps) {
  const t = useTranslations("common.fun");
  const [hop, setHop] = useState(0);
  const [talk, setTalk] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    },
    []
  );

  const onClick = () => {
    setHop((n) => n + 1);
    setTalk(pick(t.raw("wickSays") as string[]) ?? "!");
    timers.current.push(
      window.setTimeout(() => setHop(0), HOP_MS),
      window.setTimeout(() => setTalk(null), TALK_MS)
    );
  };

  return (
    <button
      aria-label={t("wickLabel")}
      className={["wick-button", className].filter(Boolean).join(" ")}
      data-hop={hop > 0 ? "" : undefined}
      onClick={onClick}
      type="button"
    >
      <span className="wick-button-body" key={hop}>
        {heroSrc ? (
          // biome-ignore lint/performance/noImgElement: delivered pixel illustration, shown 1:1 without optimisation.
          <img
            alt=""
            className="wick-hero-art"
            height={512}
            src={heroSrc}
            width={512}
          />
        ) : (
          <WickFigure scale={scale} src={src} />
        )}
      </span>
      {talk ? (
        <span aria-live="polite" className="wick-bubble">
          {talk}
        </span>
      ) : null}
    </button>
  );
}
