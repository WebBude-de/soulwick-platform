/** Pixel-art candle wick – Soulwick's mark. Pure SVG rects, no image assets. */
export function WickIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      height={size}
      shapeRendering="crispEdges"
      viewBox="0 0 16 16"
      width={size}
    >
      <g className="flicker">
        <rect fill="#f7c66b" height="1" width="2" x="7" y="1" />
        <rect fill="#f7c66b" height="2" width="4" x="6" y="2" />
        <rect fill="#e8a33d" height="2" width="6" x="5" y="4" />
        <rect fill="#fff3d1" height="2" width="2" x="7" y="4" />
        <rect fill="#a8661c" height="1" width="4" x="6" y="6" />
      </g>
      <rect fill="#33284a" height="1" width="2" x="7" y="7" />
      <rect fill="#ece4d4" height="6" width="6" x="5" y="8" />
      <rect fill="#a99cc4" height="6" width="1" x="5" y="8" />
      <rect fill="#a99cc4" height="3" width="1" x="10" y="8" />
      <rect fill="#33284a" height="1" width="8" x="4" y="14" />
    </svg>
  );
}
