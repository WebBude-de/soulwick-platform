import type { CSSProperties } from "react";
import { type SpriteId, sprites } from "@/lib/sprite-manifest";

type SpriteStyle = CSSProperties & Record<`--${string}`, string | number>;

export interface SpriteProps {
  /** Accessible name; without it the sprite is decorative (`aria-hidden`). */
  alt?: string;
  className?: string;
  /** Mirror horizontally (sprites face right by default). */
  flip?: boolean;
  /** Show only this 0-based frame, without animation. */
  frame?: number;
  /** Sheet shown while hovered (or while the nearest `.group` is hovered). */
  hoverId?: SpriteId;
  /** Loop the hover sheet while hovered (default) or play it once. */
  hoverLoop?: boolean;
  hoverTrigger?: "self" | "group";
  /** Id from `src/lib/sprite-manifest.ts` (file name without extension). */
  id: SpriteId;
  /**
   * Integer scale (2–4). A string is used verbatim as CSS, e.g. `"var(--hero-px)"`.
   * Omit it to inherit `--s` from a parent (defaults to `--px`: 2 on phones, 3 from md).
   */
  scale?: number | string;
  /** Show the first frame only. */
  still?: boolean;
  style?: CSSProperties;
  title?: string;
}

function sheetStyle(id: SpriteId, scale: SpriteProps["scale"]): SpriteStyle {
  const meta = sprites[id];
  const fps = meta.fps > 0 ? meta.fps : 1;
  const style: SpriteStyle = {
    "--sheet": `url("${meta.src}")`,
    "--fw": meta.width,
    "--fh": meta.height,
    "--frames": meta.frames,
    "--dur": `${(meta.frames / fps).toFixed(3)}s`,
  };
  if (typeof scale === "number") {
    style["--s"] = scale;
  } else if (typeof scale === "string") {
    style["--s"] = scale;
  }
  return style;
}

/**
 * Renders one sprite sheet from the game as a CSS-animated element. Server-renderable, no JS:
 * the animation is `steps(frames)` over the sheet width, `prefers-reduced-motion` shows frame 1.
 */
export function Sprite({
  id,
  scale,
  hoverId,
  hoverLoop = true,
  hoverTrigger = "self",
  flip,
  frame,
  still,
  alt,
  className,
  style,
  title,
}: SpriteProps) {
  const meta = sprites[id];
  const baseClass = ["sprite", hoverId ? "sprite-base" : className]
    .filter(Boolean)
    .join(" ");
  const baseStyle = {
    ...sheetStyle(id, scale),
    ...(frame === undefined ? {} : { "--frame": frame }),
    ...(hoverId ? {} : style),
  };
  const dataProps = {
    "data-flip": flip ? "" : undefined,
    "data-frames": meta.frames,
    "data-loop": meta.loop ? "true" : "false",
    "data-still": still || frame !== undefined ? "" : undefined,
  };
  const base = alt ? (
    <span
      {...dataProps}
      aria-label={alt}
      className={baseClass}
      role="img"
      style={baseStyle}
      title={hoverId ? undefined : title}
    />
  ) : (
    <span
      {...dataProps}
      aria-hidden="true"
      className={baseClass}
      style={baseStyle}
      title={hoverId ? undefined : title}
    />
  );

  if (!hoverId) {
    return base;
  }

  const hoverMeta = sprites[hoverId];
  return (
    <span
      className={["sprite-swap", className].filter(Boolean).join(" ")}
      data-trigger={hoverTrigger}
      style={style}
      title={title}
    >
      {base}
      <span
        aria-hidden="true"
        className="sprite sprite-hover"
        data-flip={flip ? "" : undefined}
        data-frames={hoverMeta.frames}
        data-loop={hoverLoop ? "true" : "false"}
        style={sheetStyle(hoverId, scale)}
      />
    </span>
  );
}

/** Pixel size of a sprite frame at a given integer scale (for layout math). */
export function spriteSize(id: SpriteId, scale: number) {
  const meta = sprites[id];
  return { width: meta.width * scale, height: meta.height * scale };
}
