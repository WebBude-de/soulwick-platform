import { z } from "zod";

/**
 * Danger level and rank (D-194, D-196; game repo docs/KONZEPT.md §3, §3.1). Every run starts at
 * the danger level G of the account; it is not chosen (D-196) but follows experience (the account
 * level) and skill (the deepest room of the last runs), so it can sink like matchmaking. The rank
 * is the name of G (Spark I … Beacon III, then Soul Master 1, 2, …); the level only rises.
 *
 * Pure functions, mirrored 1:1 by the game (`meta/danger_rank.gd`); integer math only, so both
 * give the same result. The server derives G from the account level and the deepest rooms of the
 * account's last XP entries (newest first, flagged entries excluded); it never stores it.
 *
 * All numbers are TESTWERT (D-194).
 */

// --- numbers (TESTWERT, KONZEPT §3) --------------------------------------------------------------

/** Levels per danger step of the experience part: G_level = floor((L − 1) / 2). */
export const DANGER_LEVELS_PER_STEP = 2;
/** Rooms per danger step of the skill part: G_skill = floor(median / 5) + 1. */
export const DANGER_ROOMS_PER_STEP = 5;
/** How many of the newest runs count for the skill part. */
export const DANGER_RECENT_RUNS = 5;
/** Fewer runs than this: the skill part is unknown and G = G_level. */
export const DANGER_MIN_RUNS = 3;
/**
 * Highest danger level that still raises the XP of a run (`runXp`); higher values reported by a
 * game count as this one. Not a limit of the rank itself.
 */
export const DANGER_MAX = 30;

/** Danger level G of an account or a run, starting at 0. */
export const DangerLevel = z.number().int().min(0);
export type DangerLevel = z.infer<typeof DangerLevel>;

const whole = (v: number) => Math.max(0, Math.floor(v));

// --- danger level --------------------------------------------------------------------------------

/** Experience part: floor((level − 1) / 2); level 1–2 = 0, 3–4 = 1, 5–6 = 2, … */
export function dangerFromLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.floor((l - 1) / DANGER_LEVELS_PER_STEP);
}

/**
 * Median of whole room numbers; for an even count the mean of the two middle values, rounded
 * down. 0 for an empty list.
 */
export function medianRoom(rooms: readonly number[]): number {
  if (rooms.length === 0) {
    return 0;
  }
  const sorted = rooms.map(whole).toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return Math.floor(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

/**
 * Skill part: floor(median(deepest room of the last DANGER_RECENT_RUNS runs) / 5) + 1.
 * `recentDeepestRooms` is newest first; only the first DANGER_RECENT_RUNS values count. null with
 * fewer than DANGER_MIN_RUNS runs (then the level part alone decides).
 */
export function dangerFromSkill(
  recentDeepestRooms: readonly number[]
): number | null {
  const recent = recentDeepestRooms.slice(0, DANGER_RECENT_RUNS);
  if (recent.length < DANGER_MIN_RUNS) {
    return null;
  }
  return Math.floor(medianRoom(recent) / DANGER_ROOMS_PER_STEP) + 1;
}

/**
 * Danger level G = min(G_level, G_skill) (KONZEPT §3); with fewer than DANGER_MIN_RUNS runs
 * G = G_level. The level is the cap, the recent runs fine-tune it.
 */
export function dangerLevel(
  level: number,
  recentDeepestRooms: readonly number[]
): number {
  const byLevel = dangerFromLevel(level);
  const bySkill = dangerFromSkill(recentDeepestRooms);
  return bySkill === null ? byLevel : Math.min(byLevel, bySkill);
}

// --- rank ----------------------------------------------------------------------------------------

/**
 * Rank names in the light motif (D-194 addendum 3): German Funke, Kerze, Flamme, Laterne,
 * Leuchtfeuer, Seelenmeister. The game translates them; ids never change.
 */
export const RankTier = z.enum([
  "spark",
  "candle",
  "flame",
  "lantern",
  "beacon",
  "soul_master",
]);
export type RankTier = z.infer<typeof RankTier>;

/** Danger levels per tier below Soul Master (I–III). */
export const RANK_STEPS_PER_TIER = 3;
/** First danger level of Soul Master (after 5 tiers of 3 steps). */
export const SOUL_MASTER_DANGER = 15;

/**
 * Rank of a danger level: `tier` plus `step` (1–3 shown as I–III; for `soul_master` the number
 * G − 14, i.e. 1, 2, … without upper bound).
 */
export const Rank = z.object({
  tier: RankTier,
  step: z.number().int().min(1),
});
export type Rank = z.infer<typeof Rank>;

/** 0–2 spark I–III, 3–5 candle, 6–8 flame, 9–11 lantern, 12–14 beacon, 15+ soul_master G−14. */
export function rankForDanger(danger: number): Rank {
  const g = whole(danger);
  if (g >= SOUL_MASTER_DANGER) {
    return { tier: "soul_master", step: g - SOUL_MASTER_DANGER + 1 };
  }
  const tier = RankTier.options[Math.floor(g / RANK_STEPS_PER_TIER)];
  return {
    tier: tier ?? "spark",
    step: (g % RANK_STEPS_PER_TIER) + 1,
  };
}

/** Danger level and rank of an account, as shown next to the level. */
export const AccountDanger = z.object({
  danger: DangerLevel,
  rank: Rank,
});
export type AccountDanger = z.infer<typeof AccountDanger>;

/** Both at once for an account with `level` and its deepest rooms (newest first). */
export function accountDanger(
  level: number,
  recentDeepestRooms: readonly number[]
): AccountDanger {
  const danger = dangerLevel(level, recentDeepestRooms);
  return { danger, rank: rankForDanger(danger) };
}
