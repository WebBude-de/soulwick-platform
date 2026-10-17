import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

/**
 * The four playable figures of the game (`soulwick/characters/*.tres`): the default figure and
 * Ember, Moss and Frost, with their own art from `art/characters/` (synced by
 * `scripts/sync-sprites.ts`). The page shows them without names: the default figure's in-game
 * name collides with the mascot Wick (KONZEPT_WEB §6).
 */
export const FIGURES = ["player", "ember", "moss", "frost"] as const;

export type FigureId = (typeof FIGURES)[number];

const SHEETS: Record<FigureId, Record<"idle" | "walk", SpriteId>> = {
  player: { idle: "player_idle_4f", walk: "player_walk_6f" },
  ember: { idle: "ember_idle_4f", walk: "ember_walk_6f" },
  moss: { idle: "moss_idle_4f", walk: "moss_walk_6f" },
  frost: { idle: "frost_idle_4f", walk: "frost_walk_6f" },
};

interface FigureProps {
  anim?: "idle" | "walk";
  className?: string;
  /** Face left (the sprites face right). */
  flip?: boolean;
  id: FigureId;
  /** Integer scale, or a CSS value like `"var(--px)"`. */
  scale: number | string;
}

/** One playable figure, standing or walking, in its original colours. */
export function Figure({
  id,
  anim = "idle",
  scale,
  flip,
  className,
}: FigureProps) {
  return (
    <Sprite
      className={["figure", className].filter(Boolean).join(" ")}
      flip={flip}
      id={SHEETS[id][anim]}
      scale={scale}
    />
  );
}
