"use client";

import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  readPreference,
  startMusic,
  subscribe,
  toggleMusic,
} from "./music-store";

/** Pixel speaker, 16×16 grid drawn with crisp rects. */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="block"
      height="24"
      shapeRendering="crispEdges"
      viewBox="0 0 16 16"
      width="24"
    >
      <g fill="currentColor">
        <rect height="4" width="2" x="2" y="6" />
        <rect height="6" width="2" x="4" y="5" />
        <rect height="8" width="2" x="6" y="4" />
        <rect height="10" width="2" x="8" y="3" />
        {on ? (
          <>
            <rect height="2" width="1" x="11" y="5" />
            <rect height="2" width="1" x="11" y="9" />
            <rect height="4" width="1" x="12" y="6" />
            <rect height="1" width="1" x="13" y="3" />
            <rect height="1" width="1" x="13" y="12" />
            <rect height="8" width="1" x="14" y="4" />
          </>
        ) : (
          <>
            <rect height="1" width="1" x="11" y="5" />
            <rect height="1" width="1" x="12" y="6" />
            <rect height="1" width="1" x="13" y="7" />
            <rect height="1" width="1" x="14" y="8" />
            <rect height="1" width="1" x="14" y="5" />
            <rect height="1" width="1" x="13" y="6" />
            <rect height="1" width="1" x="12" y="7" />
            <rect height="1" width="1" x="11" y="8" />
          </>
        )}
      </g>
    </svg>
  );
}

interface MusicToggleProps {
  className?: string;
  /** Called on click with the direction of the switch (true = the music is being turned on). */
  onToggle?: (turningOn: boolean) => void;
  /** Show the state as text next to the icon (footer); the header shows only the icon. */
  withLabel?: boolean;
}

export function MusicToggle({
  withLabel,
  className,
  onToggle,
}: MusicToggleProps) {
  const t = useTranslations("common.music");
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const on = state === "on" || state === "loading";

  // Resume if the visitor turned the music on before; browsers may still block it until a click.
  useEffect(() => {
    if (readPreference() && getSnapshot() === "off") {
      startMusic().catch(() => undefined);
    }
  }, []);

  const disabled = state === "unsupported";
  const text = on ? t("on") : t("off");

  return (
    <button
      aria-label={withLabel ? undefined : `${t("label")} (${text})`}
      aria-pressed={on}
      className={[
        "inline-flex min-h-11 items-center gap-2 px-2 font-pixel text-base transition-colors",
        on ? "text-gold" : "text-muted hover:text-text",
        disabled ? "cursor-not-allowed opacity-60" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      onClick={() => {
        onToggle?.(!on);
        toggleMusic();
      }}
      title={disabled ? t("unsupported") : `${t("track")}: ${text}`}
      type="button"
    >
      <SpeakerIcon on={on} />
      {withLabel ? <span>{text}</span> : null}
    </button>
  );
}
