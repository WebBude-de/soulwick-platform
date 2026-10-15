/**
 * Small pixel icons copied from the website's brand package into public/brand/sprites/.
 * Decorative only (aria-hidden); always shown at integer scales (TOKENS §4).
 */
const ICONS = {
  overview: { file: "crystal_icon.webp", size: 16 },
  players: { file: "shield_icon.webp", size: 16 },
  /** Tower emblem, frame 6 of the 8 guild emblems (24 px each). */
  guilds: { file: "guild_emblems.webp", size: 24, frame: 6, frames: 8 },
  runs: { file: "trophy_icon.webp", size: 16 },
  stats: { file: "icon_leaderboard.webp", size: 16 },
  live: { file: "icon_ping_good.webp", size: 16 },
  deletion: { file: "skull_icon.webp", size: 16 },
  audit: { file: "clock_icon.webp", size: 16 },
  admins: { file: "icon_host.webp", size: 16 },
  lock: { file: "icon_lock.webp", size: 16 },
  info: { file: "icon_info.webp", size: 16 },
  gold: { file: "gold_icon.webp", size: 16 },
  done: { file: "chip_done.webp", size: 16 },
} as const;

export type IconName = keyof typeof ICONS;

export function PixelIcon({
  name,
  scale = 1,
  className = "",
}: {
  name: IconName;
  scale?: 1 | 2 | 3;
  className?: string;
}) {
  const icon: { file: string; size: number; frame?: number; frames?: number } =
    ICONS[name];
  const px = icon.size * scale;
  return (
    <span
      aria-hidden="true"
      className={`pixel-icon ${className}`}
      style={{
        width: px,
        height: px,
        backgroundImage: `url(/brand/sprites/${icon.file})`,
        backgroundSize: `${px * (icon.frames ?? 1)}px ${px}px`,
        backgroundPosition: `${-px * (icon.frame ?? 0)}px 0`,
      }}
    />
  );
}
