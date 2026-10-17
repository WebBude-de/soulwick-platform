/**
 * Small pixel icons drawn as crisp SVG rects on a 16×16 grid, for places where no sprite exists
 * yet. `play`, `install` and the social channels follow the text colour (they sit on buttons and
 * links); `browser` and `tablet` (a tablet with a phone in front) use the palette of the
 * platform chip sprites (ink rim, stone frame, blue screen). Store and platform logos are never
 * redrawn here: their owners only allow their own artwork.
 */
export type SocialIconName =
  | "discord"
  | "tiktok"
  | "youtube"
  | "instagram"
  | "x"
  | "reddit";

export type PixelIconName =
  | "browser"
  | "install"
  | "play"
  | "tablet"
  | SocialIconName;

interface PixelIconProps {
  name: PixelIconName;
  /** Rendered size in CSS pixels (multiple of 16 keeps the pixels square). */
  size?: number;
}

/** Social glyphs as 16 rows of 16 cells (`#` = filled), simplified to the pixel grid. */
const GLYPHS: Record<SocialIconName, string[]> = {
  discord: [
    "................",
    "................",
    "...##......##...",
    "..############..",
    ".##############.",
    ".##############.",
    ".###..####..###.",
    ".###..####..###.",
    ".##############.",
    ".##############.",
    ".#####....#####.",
    "..###......###..",
    "...#........#...",
    "................",
    "................",
    "................",
  ],
  tiktok: [
    "................",
    ".........##.....",
    ".........###....",
    ".........####...",
    ".........##.##..",
    ".........##..##.",
    ".........##.....",
    ".........##.....",
    ".........##.....",
    ".....######.....",
    "....#######.....",
    "...########.....",
    "...#######......",
    "....#####.......",
    "................",
    "................",
  ],
  youtube: [
    "................",
    "................",
    "................",
    "..############..",
    ".##############.",
    ".######.#######.",
    ".######..######.",
    ".######...#####.",
    ".######....####.",
    ".######...#####.",
    ".######..######.",
    ".######.#######.",
    ".##############.",
    "..############..",
    "................",
    "................",
  ],
  instagram: [
    "................",
    "..############..",
    ".##..........##.",
    ".#.........##.#.",
    ".#.........##.#.",
    ".#....####....#.",
    ".#...##..##...#.",
    ".#..##....##..#.",
    ".#..##....##..#.",
    ".#...##..##...#.",
    ".#....####....#.",
    ".#............#.",
    ".##..........##.",
    "..############..",
    "................",
    "................",
  ],
  x: [
    "................",
    ".###........##..",
    "..###......##...",
    "...###....##....",
    "....###..##.....",
    ".....#####......",
    "......###.......",
    "......####......",
    ".....##.###.....",
    "....##...###....",
    "...##.....###...",
    "..##.......###..",
    ".##.........###.",
    "................",
    "................",
    "................",
  ],
  reddit: [
    "..........##....",
    "......###.##....",
    "......#.........",
    "......#.........",
    "....########....",
    ".##.##########.#",
    ".##############.",
    "..###..##..###..",
    "..###..##..###..",
    "..############..",
    "..###.####.###..",
    "...###....###...",
    "....########....",
    "................",
    "................",
    "................",
  ],
};

/** Colours of the device icons (same as the `chip_pc` / `chip_mobile` sprites). */
const DEVICE: Record<string, string> = {
  k: "#1c1a2b",
  g: "#8c8f9a",
  d: "#5a5f6a",
  b: "#3690da",
  l: "#6cb2ec",
};

/** Tablet with a phone in front (iPhone & iPad), drawn without any brand mark. */
const TABLET = [
  "................",
  "kkkkkkkkkkkk....",
  "kggggggggggk....",
  "kgbbbbbbbbgk....",
  "kgbllbbbbbgk....",
  "kgblbbbbbkkkkkkk",
  "kgbbbbbbbkgggggk",
  "kgbbbbbbbkgbbbgk",
  "kgbbbbbbbkgblbgk",
  "kgbbbbbbbkgbbbgk",
  "kgbbbbbbbkgbbbgk",
  "kgbbbbbbbkgbbbgk",
  "kgbbbbbbbkgbbbgk",
  "kggggggggkggdggk",
  "kkkkkkkkkkgggggk",
  ".........kkkkkkk",
];

/** A colour glyph (one letter per palette colour, `.` = empty), merged into runs. */
function ColorGlyph({ rows }: { rows: string[] }) {
  const rects: { color: string; w: number; x: number; y: number }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const char = row[x] ?? ".";
      let end = x + 1;
      while (end < row.length && row[end] === char) {
        end += 1;
      }
      const color = DEVICE[char];
      if (color) {
        rects.push({ color, x, y, w: end - x });
      }
      x = end;
    }
  });
  return rects.map((r) => (
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

/** Merges each glyph row into runs, so a glyph is a few dozen rects. */
function Glyph({ rows }: { rows: string[] }) {
  const rects: { h: number; w: number; x: number; y: number }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] === "#") {
        let end = x + 1;
        while (row[end] === "#") {
          end += 1;
        }
        rects.push({ x, y, w: end - x, h: 1 });
        x = end;
      } else {
        x += 1;
      }
    }
  });
  return (
    <g fill="currentColor">
      {rects.map((r) => (
        <rect height={r.h} key={`${r.x}-${r.y}`} width={r.w} x={r.x} y={r.y} />
      ))}
    </g>
  );
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
  if (name === "browser") {
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
  if (name === "tablet") {
    return <ColorGlyph rows={TABLET} />;
  }
  return <Glyph rows={GLYPHS[name]} />;
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
