/**
 * Small pixel icons drawn as crisp SVG rects on a 16×16 grid, for places where no sprite exists
 * yet. `play` and `install` follow the text colour (they sit on buttons); `browser` uses the
 * palette of the platform chip sprites (ink rim, stone frame, blue screen).
 */
export type PixelIconName = "browser" | "install" | "play";

interface PixelIconProps {
  name: PixelIconName;
  /** Rendered size in CSS pixels (multiple of 16 keeps the pixels square). */
  size?: number;
}

function Shapes({ name }: { name: PixelIconName }) {
  if (name === "play") {
    return (
      <g fill="currentColor">
        <rect height="12" width="2" x="4" y="2" />
        <rect height="10" width="2" x="6" y="3" />
        <rect height="8" width="2" x="8" y="4" />
        <rect height="6" width="2" x="10" y="5" />
        <rect height="4" width="2" x="12" y="6" />
      </g>
    );
  }
  if (name === "install") {
    return (
      <g fill="currentColor">
        <rect height="6" width="2" x="7" y="0" />
        <rect height="2" width="8" x="4" y="6" />
        <rect height="2" width="4" x="6" y="8" />
        <rect height="1" width="2" x="7" y="10" />
        <rect height="3" width="2" x="1" y="10" />
        <rect height="3" width="2" x="13" y="10" />
        <rect height="2" width="14" x="1" y="13" />
      </g>
    );
  }
  return (
    <>
      <rect fill="#1c1a2b" height="14" width="16" x="0" y="1" />
      <rect fill="#8c8f9a" height="12" width="14" x="1" y="2" />
      <rect fill="#5a5f6a" height="2" width="12" x="2" y="3" />
      <rect fill="#f2cf4a" height="1" width="1" x="3" y="3" />
      <rect fill="#3690da" height="7" width="12" x="2" y="6" />
      <rect fill="#6cb2ec" height="1" width="4" x="3" y="7" />
      <rect fill="#6cb2ec" height="1" width="2" x="3" y="8" />
    </>
  );
}

/** Decorative pixel icon (`aria-hidden`); the surrounding text carries the meaning. */
export function PixelIcon({ name, size = 16 }: PixelIconProps) {
  return (
    <svg
      aria-hidden="true"
      className="pixel-icon"
      height={size}
      shapeRendering="crispEdges"
      viewBox="0 0 16 16"
      width={size}
    >
      <Shapes name={name} />
    </svg>
  );
}
