"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, useSyncExternalStore } from "react";
import {
  getServerVolume,
  getVolume,
  setVolume,
  subscribe,
} from "./music-store";

interface VolumeSliderProps {
  className?: string;
}

/**
 * Pixel volume bar (styled `input type=range`, see `.vol` in globals.css): arrow keys, Home/End
 * and touch drag work natively. The value is shared with every music control on the page.
 */
export function VolumeSlider({ className }: VolumeSliderProps) {
  const t = useTranslations("common.music");
  const volume = useSyncExternalStore(subscribe, getVolume, getServerVolume);
  const percent = Math.round(volume * 100);

  return (
    <label className={["vol", className].filter(Boolean).join(" ")}>
      <span className="vol-label">{t("volume")}</span>
      <input
        aria-valuetext={t("volumeValue", { value: percent })}
        className="vol-range"
        max={100}
        min={0}
        onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)}
        step={5}
        style={{ "--vol": `${percent}%` } as CSSProperties}
        type="range"
        value={percent}
      />
      <span aria-hidden="true" className="vol-value">
        {percent}
      </span>
    </label>
  );
}
