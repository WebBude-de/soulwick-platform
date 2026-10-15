import type { CSSProperties } from "react";
import { sprites } from "@/lib/sprite-manifest";

/** Order of the 16×16 icons in `door_mode_symbols` (the symbols above the game's doors). */
export const MODE_SYMBOLS = [
  "combat",
  "escort",
  "flame",
  "relic",
  "souls",
  "rifts",
  "hunt",
  "lightfire",
  "collapse",
  "miniboss",
] as const;
export type ModeSymbol = (typeof MODE_SYMBOLS)[number];

const SHEET = sprites.door_mode_symbols;
const SIZE = 16;

/** One room-mode symbol from the door symbol strip, at an integer scale. */
export function ModeSymbolIcon({
  mode,
  scale = 2,
  className,
}: {
  mode: ModeSymbol;
  scale?: number;
  className?: string;
}) {
  const index = MODE_SYMBOLS.indexOf(mode);
  const style: CSSProperties = {
    width: SIZE * scale,
    height: SIZE * scale,
    backgroundImage: `url("${SHEET.src}")`,
    backgroundSize: `${SHEET.width * scale}px ${SIZE * scale}px`,
    backgroundPosition: `${-index * SIZE * scale}px 0`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
  return (
    <span
      aria-hidden="true"
      className={["inline-block flex-none", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
    />
  );
}
