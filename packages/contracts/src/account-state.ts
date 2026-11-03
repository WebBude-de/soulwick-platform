import { z } from "zod";
import { IsoDateTime, PlayerLevel, Uuid } from "./common.ts";
import { DangerLevel, Rank } from "./rank.ts";

/**
 * Account state (D-194, KF3b; game repo docs/KONZEPT.md §4, §6, §10): what belongs to the account
 * instead of a world and is not a cloud world itself: the talent tree, the equipped spells and
 * the seen flags of one-time explanations (village tour, room intros). Same on every device and
 * in every world.
 *
 * Merge rules (KONZEPT §10):
 * - talents and spells are one unit ("the build"): **last change wins** by `changedAt`, the
 *   device time of the change; values more than ACCOUNT_STATE_FUTURE_TOLERANCE_SECONDS ahead of
 *   the server clock count as the server time. An older build is ignored (200 with the server's
 *   build, `talentsApplied` false), so the game adopts the answer.
 * - seen flags: union; a flag is never removed.
 * - merging accounts (D-122): the newer build stays, the seen flags are united.
 * Points: the talent levels may sum up to at most `talentPointsForLevel(level)` = level − 1 of the
 * account's server level (`PlayerSelf.level`). Upload open XP entries (`POST /me/xp`) before
 * `PUT /me/state`, otherwise the server level may still be too low.
 *
 * Read only in the answer (derived, never sent): level, talent points, danger level, rank and
 * the recent runs the rank comes from.
 *
 * All limits are TESTWERT. GDScript mirror: `talentPointsForLevel`.
 */

// --- limits (TESTWERT) ---------------------------------------------------------------------------

/** Most different talents with a level (the tree has about 20, KONZEPT §6.1). */
export const ACCOUNT_STATE_MAX_TALENTS = 64;
/** Highest level of one talent (the tree goes up to 5×). */
export const ACCOUNT_STATE_MAX_TALENT_LEVEL = 10;
/** Most equipped spells (KONZEPT §6.2: one slot, two with the keystone). */
export const ACCOUNT_STATE_MAX_SPELLS = 4;
/** Most seen flags of an account; a PUT that would go beyond gets 409 `seen_limit_reached`. */
export const ACCOUNT_STATE_MAX_SEEN = 512;
/** `changedAt` more than this far ahead of the server clock counts as the server time. */
export const ACCOUNT_STATE_FUTURE_TOLERANCE_SECONDS = 300;
/** Largest body of `PUT /me/state` (413 `payload_too_large` beyond). */
export const ACCOUNT_STATE_MAX_BODY_BYTES = 65_536;

/** Talent points of a level (KONZEPT §4): one per level from level 2, so level − 1. */
export function talentPointsForLevel(level: number): number {
  return Math.max(0, Math.floor(level) - 1);
}

/** Sum of the talent levels. */
export function talentPointsSpent(talents: Readonly<Record<string, number>>) {
  return Object.values(talents).reduce((sum, v) => sum + Math.max(0, v), 0);
}

// --- ids -----------------------------------------------------------------------------------------

/** Talent id of the game, e.g. `wind_light_foot` (lower case, digits, `_`; 1–32 characters). */
export const TalentId = z
  .string()
  .regex(/^[a-z0-9_]{1,32}$/, "lower case letters, digits and _ only");
export type TalentId = z.infer<typeof TalentId>;

/** Spell id of the game, e.g. `light_flash`; same rules as TalentId. */
export const SpellId = TalentId;
export type SpellId = z.infer<typeof SpellId>;

/** Seen flag, e.g. `explain.forge` or `tutorial:done` (also `.`, `:`, `-`; 1–64 characters). */
export const SeenFlag = z
  .string()
  .regex(/^[a-z0-9_.:-]{1,64}$/, "lower case letters, digits and _ . : - only");
export type SeenFlag = z.infer<typeof SeenFlag>;

// --- values --------------------------------------------------------------------------------------

/** Talent id → level. Level 0 means "not taken" and is not stored (the answer omits it). */
export const TalentLevels = z
  .record(TalentId, z.number().int().min(0).max(ACCOUNT_STATE_MAX_TALENT_LEVEL))
  .refine((t) => Object.keys(t).length <= ACCOUNT_STATE_MAX_TALENTS, {
    message: `at most ${ACCOUNT_STATE_MAX_TALENTS} talents`,
  });
export type TalentLevels = z.infer<typeof TalentLevels>;

/** Equipped spells in slot order (slot 1 first), each id at most once. */
export const EquippedSpells = z
  .array(SpellId)
  .max(ACCOUNT_STATE_MAX_SPELLS)
  .refine((s) => new Set(s).size === s.length, {
    message: "each spell at most once",
  });
export type EquippedSpells = z.infer<typeof EquippedSpells>;

/** One of the account's newest runs that make up the skill part of the danger level. */
export const RecentRun = z.object({
  runId: Uuid,
  /** Deepest room of that run (from the XP entry). */
  deepestRoom: z.number().int().min(0),
  /** Danger level the run was played at (0 for entries of older game builds). */
  danger: DangerLevel,
  endedAt: IsoDateTime,
});
export type RecentRun = z.infer<typeof RecentRun>;

/** `GET /me/state` → 200. Also the answer of `PUT /me/state` (plus `talentsApplied`). */
export const AccountState = z.object({
  /** Talent id → level (≥ 1 only). Empty for a new account. */
  talents: TalentLevels,
  /** Equipped spells, slot order. */
  spells: EquippedSpells,
  /** When the build (talents + spells) was last changed on a device; null = never. */
  changedAt: IsoDateTime.nullable(),
  /** Seen flags, sorted. */
  seen: z.array(SeenFlag),
  /** Server time of the last write; null = never written. */
  updatedAt: IsoDateTime.nullable(),
  /** Read only: the account level (`PlayerSelf.level`). */
  level: PlayerLevel,
  /** Read only: `talentPointsForLevel(level)`. */
  talentPoints: z.number().int().min(0),
  /** Read only: sum of `talents`. */
  talentPointsSpent: z.number().int().min(0),
  /** Read only: danger level (rank.ts `dangerLevel`). */
  danger: DangerLevel,
  /** Read only: rank of `danger`. */
  rank: Rank,
  /**
   * Read only: the newest runs (at most DANGER_RECENT_RUNS, newest first) the server took for the
   * skill part; flagged entries are left out. A new device takes them as its "last runs".
   */
  recentRuns: z.array(RecentRun),
});
export type AccountState = z.infer<typeof AccountState>;

/**
 * `PUT /me/state` (player session): sends the own build and/or seen flags.
 * - `talents`, `spells` and `changedAt` come together (the whole build, never a part);
 * - `seen` alone is fine (only the new flags are needed, sending all is fine too);
 * - at least one of both.
 * Answer: 200 `PutAccountStateResponse`. Errors: 400 `validation_error`, 401 `unauthorized`,
 * 403 `banned`, 409 `talent_points_exceeded` (the levels sum up to more than level − 1; body
 * `level`, `talentPoints`, `talentPointsSpent`; nothing of the request is stored), 409
 * `seen_limit_reached` (union beyond ACCOUNT_STATE_MAX_SEEN; body `maxSeen`; nothing stored),
 * 413 `payload_too_large`.
 */
export const PutAccountStateRequest = z
  .object({
    talents: TalentLevels.optional(),
    spells: EquippedSpells.optional(),
    /** Device time of the last change of the build (talents or spells). */
    changedAt: IsoDateTime.optional(),
    seen: z.array(SeenFlag).max(ACCOUNT_STATE_MAX_SEEN).optional(),
  })
  .refine(
    (r) =>
      (r.talents === undefined) === (r.spells === undefined) &&
      (r.talents === undefined) === (r.changedAt === undefined),
    {
      message: "talents, spells and changedAt come together",
      path: ["talents"],
    }
  )
  .refine((r) => r.talents !== undefined || r.seen !== undefined, {
    message: "talents (with spells and changedAt) or seen required",
  });
export type PutAccountStateRequest = z.infer<typeof PutAccountStateRequest>;

export const PutAccountStateResponse = AccountState.extend({
  /**
   * true = the sent build is stored now; false = no build was sent, or the server's build was
   * changed later (then `talents`, `spells` and `changedAt` are the server's; take them over).
   */
  talentsApplied: z.boolean(),
});
export type PutAccountStateResponse = z.infer<typeof PutAccountStateResponse>;
