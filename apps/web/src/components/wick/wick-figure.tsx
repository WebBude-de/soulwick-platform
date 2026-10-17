import type { CSSProperties } from "react";

/**
 * Wick, the mascot (D-175): a tiny wick creature, a small living candle with a flame on its head.
 *
 * Until the real art exists (`public/brand/wick/wick_idle_6f.webp`, see
 * `docs/design/web/BRIEFING_WEB.md`) this draws a placeholder in pixel rects. Both share one
 * 32×32 frame with the feet at (16, 30), so the delivered strip drops in without layout changes.
 */

/** Frame of the delivered idle strip (BRIEFING_WEB.md): 32×32, 6 frames, 8 fps. */
export const WICK_FRAME = 32;
const WICK_FRAMES = 6;
const WICK_FPS = 8;

const COLORS: Record<string, string> = {
  k: "#1c1a2b", // outline, eyes, mouth
  t: "#3b3650", // the wick thread
  o: "#ff8a3c", // flame rim
  y: "#ffb54a", // flame
  w: "#fff3c4", // flame core
  c: "#efe6cf", // wax body
  h: "#ffffff", // highlight
  s: "#b9b3c9", // body shade
  p: "#f0648c", // cheeks
};

/**
 * 16 × 24 placeholder, drawn into the 32×32 frame at (8, 7): a candle 10 px wide and 14 rows of
 * wax tall, so it reads as a little candle and not as a square, with a flame, two eyes high up,
 * round cheeks and a few wax highlights running down one side.
 */
const FLAME = [
  "........o.......",
  ".......ooo......",
  ".......oyo......",
  "......oyyyo.....",
  "......oywyo.....",
  ".....oywwwyo....",
  ".....oywwwyo....",
  "......oyyyo.....",
];
const BODY = [
  "........t.......",
  ".....kkkkkk.....",
  "....khccccsk....",
  "...khcccccssk...",
  "...kccccccssk...",
  "...kccccccssk...",
  "...kccccccssk...",
  "...kpcccccpsk...",
  "...kccckccssk...",
  "...kcccccccsk...",
  "...khccccccsk...",
  "...kcccccccsk...",
  "...khcccccssk...",
  "....kssssssk....",
  ".....kkkkkk.....",
  ".....kk..kk.....",
];
/** Eyes (2 px tall) sit on body rows 4–5 and blink on their own. */
const EYES = [6, 9];
const OFFSET_X = 8;
/** Feet on row 30 of the frame, like the delivered strip will have them. */
const OFFSET_Y = 31 - FLAME.length - BODY.length;

interface Run {
  color: string;
  w: number;
  x: number;
  y: number;
}

/** Merges each row into runs of one colour, so the placeholder is a few dozen rects. */
function runs(rows: string[], top: number): Run[] {
  const out: Run[] = [];
  rows.forEach((row, rowIndex) => {
    let x = 0;
    while (x < row.length) {
      const char = row[x] ?? ".";
      let end = x + 1;
      while (end < row.length && row[end] === char) {
        end += 1;
      }
      const color = COLORS[char];
      if (color) {
        out.push({
          color,
          x: x + OFFSET_X,
          y: rowIndex + top,
          w: end - x,
        });
      }
      x = end;
    }
  });
  return out;
}

const FLAME_RUNS = runs(FLAME, OFFSET_Y);
const BODY_RUNS = runs(BODY, OFFSET_Y + FLAME.length);
const EYE_Y = OFFSET_Y + FLAME.length + 4;

function Rects({ list }: { list: Run[] }) {
  return list.map((r) => (
    <rect
      fill={r.color}
      height={1}
      key={`${r.x}-${r.y}`}
      width={r.w}
      x={r.x}
      y={r.y}
    />
  ));
}

export interface WickFigureProps {
  /** Accessible name; without it Wick is decorative. */
  alt?: string;
  className?: string;
  /** Integer scale, or a CSS value such as `"var(--px)"`. Default: `--px` (2 on phones, 3 from md). */
  scale?: number | string;
  /** Delivered idle strip (`brand.wick().idle`), `null` draws the placeholder. */
  src: string | null;
  style?: CSSProperties;
}

export function WickFigure({
  src,
  scale,
  alt,
  className,
  style,
}: WickFigureProps) {
  const vars = {
    ...(scale === undefined ? {} : { "--s": scale }),
    ...style,
  } as CSSProperties;
  const a11y = alt
    ? { role: "img" as const, "aria-label": alt }
    : { "aria-hidden": true as const };

  if (src) {
    const sheet = {
      ...vars,
      "--sheet": `url("${src}")`,
      "--fw": WICK_FRAME,
      "--fh": WICK_FRAME,
      "--frames": WICK_FRAMES,
      "--dur": `${(WICK_FRAMES / WICK_FPS).toFixed(3)}s`,
    } as CSSProperties;
    return (
      <span
        {...a11y}
        className={["sprite wick wick-art", className]
          .filter(Boolean)
          .join(" ")}
        data-frames={WICK_FRAMES}
        data-loop="true"
        style={sheet}
      />
    );
  }

  const classes = ["wick wick-placeholder", className]
    .filter(Boolean)
    .join(" ");
  const drawing = (
    <g className="wick-bob">
      <g className="wick-flame">
        <Rects list={FLAME_RUNS} />
      </g>
      <Rects list={BODY_RUNS} />
      <g className="wick-eyes">
        {EYES.map((x) => (
          <rect
            fill={COLORS.k}
            height={2}
            key={x}
            width={1}
            x={x + OFFSET_X}
            y={EYE_Y}
          />
        ))}
      </g>
    </g>
  );

  if (alt) {
    return (
      <svg
        aria-label={alt}
        className={classes}
        role="img"
        shapeRendering="crispEdges"
        style={vars}
        viewBox={`0 0 ${WICK_FRAME} ${WICK_FRAME}`}
      >
        <title>{alt}</title>
        {drawing}
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className={classes}
      shapeRendering="crispEdges"
      style={vars}
      viewBox={`0 0 ${WICK_FRAME} ${WICK_FRAME}`}
    >
      {drawing}
    </svg>
  );
}
