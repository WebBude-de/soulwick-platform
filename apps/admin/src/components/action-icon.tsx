/**
 * Small pixel glyphs for row action buttons (8×8 grid drawn at 2×, `currentColor`). Decorative:
 * the button carries the label (aria-label + title).
 */
const GLYPHS = {
  /** Delete. */
  trash: [
    "..####..",
    "########",
    "........",
    ".#.##.#.",
    ".#.##.#.",
    ".#.##.#.",
    ".#.##.#.",
    "..####..",
  ],
  /** Release a flagged run. */
  check: [
    "........",
    ".......#",
    "......##",
    "#....##.",
    "##..##..",
    ".####...",
    "..##....",
    "........",
  ],
  /** Flag a run. */
  flag: [
    ".#......",
    ".######.",
    ".#######",
    ".######.",
    ".#......",
    ".#......",
    ".#......",
    "###.....",
  ],
  /** Remove a player from a room or a guild. */
  exit: [
    "####....",
    "#.......",
    "#....#..",
    "#.######",
    "#....#..",
    "#.......",
    "####....",
    "........",
  ],
  /** Close a room. */
  close: [
    "##....##",
    "###..###",
    ".######.",
    "..####..",
    "..####..",
    ".######.",
    "###..###",
    "##....##",
  ],
  /** Hand over guild leadership. */
  crown: [
    "........",
    "#..##..#",
    "##.##.##",
    "########",
    "########",
    ".######.",
    "........",
    ".######.",
  ],
} as const;

export type ActionIconName = keyof typeof GLYPHS;

const paths = Object.fromEntries(
  Object.entries(GLYPHS).map(([name, rows]) => [
    name,
    rows
      .flatMap((row, y) =>
        [...row].map((cell, x) => (cell === "#" ? `M${x} ${y}h1v1h-1z` : ""))
      )
      .join(""),
  ])
) as Record<ActionIconName, string>;

export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={16}
      shapeRendering="crispEdges"
      viewBox="0 0 8 8"
      width={16}
    >
      <path d={paths[name]} />
    </svg>
  );
}
