import { z } from "zod";
import { IsoDateTime, PlayerLevel, Uuid } from "./common.ts";
import { GameVersion, MAX_ROOM_PLAYERS, RunEndReason } from "./lobby.ts";

/**
 * Account XP and level (D-188, game repo docs/KONZEPT_KONTO_FORTSCHRITT.md §5). XP belong to the
 * account (all worlds, solo and co-op, every device) and are cosmetic only (D-176, D-081). The
 * game counts them offline as entries per run (`user://progress.cfg`) and uploads open entries
 * with `POST /me/xp`; a run id counts exactly once per account, so two devices never conflict.
 *
 * Who computes what (KF3): the game reports the **counts** of a run (rooms, champions, bosses,
 * deepest room, end reason, players); the server computes the XP with `runXp()` below, the same
 * function the game mirrors for the "+XP" at the end of a run. The account record bonus and the
 * first run of the day are derived by the server from the account's own entries (the game shows
 * its local estimate until the next sync; afterwards `PlayerSelf.xp` is the truth). Every client
 * reports only its own player, also in co-op; the host never reports XP for others. The co-op
 * bonus follows the reported `players` (XP are capped and cosmetic, so the server trusts it).
 *
 * All numbers are TESTWERT (D-188). GDScript mirrors: `xpForLevel`, `levelForXp`, `runXp`.
 */

// --- numbers (TESTWERT, D-188 §5.2, §5.3, §5.6) ----------------------------------------------

/** XP per source (Konzept §5.2). `recordRoom` = per room beyond the old account record. */
export const XP_VALUES = {
  room: 5,
  champion: 10,
  boss: 50,
  recordRoom: 5,
  portal: 20,
  firstRunOfDay: 25,
} as const;

/** Co-op bonus on the whole run (2–4 players), in percent; rounded down. */
export const XP_COOP_BONUS_PERCENT = 20;
/** Most XP one run entry can bring (after the co-op bonus). */
export const XP_MAX_PER_RUN = 2000;
/** Most XP an account is credited per UTC day of the upload; further entries are `deferred`. */
export const XP_MAX_PER_DAY = 20_000;
/** Level curve factor: XP for level L in total = XP_LEVEL_FACTOR · L · (L − 1). */
export const XP_LEVEL_FACTOR = 50;
/** Most entries per `POST /me/xp` (offline backlog goes in several requests). */
export const XP_ENTRIES_PER_REQUEST = 50;
/** `endedAt` more than this far in the future is set to the server time (device clock off). */
export const XP_FUTURE_TOLERANCE_SECONDS = 300;

// --- level curve ---------------------------------------------------------------------------------

/**
 * Total XP at which `level` starts: 50 · L · (L − 1) (Konzept §5.3). Level 1 = 0, 2 = 100,
 * 3 = 300, 5 = 1 000, 10 = 4 500, 20 = 19 000, 50 = 122 500. No highest level.
 */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return XP_LEVEL_FACTOR * l * (l - 1);
}

/** Level for a total XP value (at least 1); the inverse of `xpForLevel`. */
export function levelForXp(xp: number): number {
  const total = Math.max(0, Math.floor(xp));
  // Solve 50·L·(L−1) <= xp, then correct float rounding by one step either way.
  let level = Math.max(
    1,
    Math.floor((1 + Math.sqrt(1 + (4 * total) / XP_LEVEL_FACTOR)) / 2)
  );
  while (xpForLevel(level + 1) <= total) {
    level += 1;
  }
  while (level > 1 && xpForLevel(level) > total) {
    level -= 1;
  }
  return level;
}

/**
 * Level state of an account: total XP, level, where the level started and where the next one
 * starts. The main menu shows "Level 7 · (xp − levelStartXp) / (nextLevelXp − levelStartXp) XP".
 */
export const AccountLevel = z.object({
  /** Total XP of the account. */
  xp: z.number().int().min(0),
  /** Account level, starting at 1 (`levelForXp(xp)`). */
  level: PlayerLevel,
  /** `xpForLevel(level)`. */
  levelStartXp: z.number().int().min(0),
  /** `xpForLevel(level + 1)`. */
  nextLevelXp: z.number().int().min(0),
  /** `nextLevelXp − xp`: XP still missing for the next level. */
  xpToNextLevel: z.number().int().min(1),
});
export type AccountLevel = z.infer<typeof AccountLevel>;

export function accountLevel(xp: number): AccountLevel {
  const total = Math.max(0, Math.floor(xp));
  const level = levelForXp(total);
  const nextLevelXp = xpForLevel(level + 1);
  return {
    xp: total,
    level,
    levelStartXp: xpForLevel(level),
    nextLevelXp,
    xpToNextLevel: nextLevelXp - total,
  };
}

// --- XP of one run -------------------------------------------------------------------------------

/** What `runXp` needs; `recordRooms` and `firstRunOfDay` are decided by the server on upload. */
export interface RunXpInput {
  bosses: number;
  champions: number;
  endReason: RunEndReason;
  firstRunOfDay: boolean;
  /** Players in the run including oneself (1–4); 2 or more = co-op bonus. */
  players: number;
  /** Rooms beyond the old account record (0 if none). */
  recordRooms: number;
  rooms: number;
}

/** XP per source of one run; `total` includes the co-op bonus and the cap. */
export const XpBreakdown = z.object({
  rooms: z.number().int().min(0),
  champions: z.number().int().min(0),
  bosses: z.number().int().min(0),
  record: z.number().int().min(0),
  portal: z.number().int().min(0),
  firstRunOfDay: z.number().int().min(0),
  /** XP_COOP_BONUS_PERCENT of the sum above (rounded down), 0 for solo runs. */
  coopBonus: z.number().int().min(0),
  /** min(sum + coopBonus, XP_MAX_PER_RUN). */
  total: z.number().int().min(0),
  /** true = the run hit XP_MAX_PER_RUN. */
  capped: z.boolean(),
});
export type XpBreakdown = z.infer<typeof XpBreakdown>;

/**
 * XP of one run (Konzept §5.2): room 5, champion 10, boss 50, 5 per room beyond the account
 * record, portal 20, first run of the day 25; co-op (2+ players) +20 % on the whole run, rounded
 * down; at most XP_MAX_PER_RUN. Integer math only, so GDScript gets the same result.
 */
export function runXp(input: RunXpInput): XpBreakdown {
  const n = (v: number) => Math.max(0, Math.floor(v));
  const parts = {
    rooms: n(input.rooms) * XP_VALUES.room,
    champions: n(input.champions) * XP_VALUES.champion,
    bosses: n(input.bosses) * XP_VALUES.boss,
    record: n(input.recordRooms) * XP_VALUES.recordRoom,
    portal: input.endReason === "portal" ? XP_VALUES.portal : 0,
    firstRunOfDay: input.firstRunOfDay ? XP_VALUES.firstRunOfDay : 0,
  };
  const sum =
    parts.rooms +
    parts.champions +
    parts.bosses +
    parts.record +
    parts.portal +
    parts.firstRunOfDay;
  const coopBonus =
    input.players >= 2 ? Math.floor((sum * XP_COOP_BONUS_PERCENT) / 100) : 0;
  const total = Math.min(sum + coopBonus, XP_MAX_PER_RUN);
  return {
    ...parts,
    coopBonus,
    total,
    capped: sum + coopBonus > XP_MAX_PER_RUN,
  };
}

/** UTC day ("YYYY-MM-DD") of a run end: the day of the first-run-of-the-day bonus. */
export function xpDayOf(endedAt: Date | string): string {
  return new Date(endedAt).toISOString().slice(0, 10);
}

// --- POST /me/xp ---------------------------------------------------------------------------------

/** One finished run of the own player, as the game counted it (Konzept §5.6). */
export const XpEntry = z.object({
  /**
   * UUID the game creates once per run (also for solo and offline runs) and keeps until the
   * server confirmed it. Counts exactly once per account; a repeat answers `duplicate`.
   */
  runId: Uuid,
  /** When the run ended (device clock). More than XP_FUTURE_TOLERANCE_SECONDS ahead = server time. */
  endedAt: IsoDateTime,
  durationSeconds: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3600),
  gameVersion: GameVersion,
  /** Rooms cleared in this run (minigame and arena rooms included). */
  rooms: z.number().int().min(0).max(10_000),
  champions: z.number().int().min(0).max(1000),
  bosses: z.number().int().min(0).max(1000),
  /** Deepest room reached in this run (for the account record bonus and the plausibility check). */
  deepestRoom: z.number().int().min(0).max(100_000),
  endReason: RunEndReason,
  /** Players in the run including oneself: 1 = solo, 2–4 = co-op (+20 %). */
  players: z.number().int().min(1).max(MAX_ROOM_PLAYERS),
});
export type XpEntry = z.infer<typeof XpEntry>;

/**
 * `POST /me/xp` (player session): uploads open XP entries, oldest first, at most
 * XP_ENTRIES_PER_REQUEST. Run ids must be unique within the request. Answer: 200 `AddXpResponse`
 * (also when every entry was known already). Errors: 400 `validation_error`, 401 `unauthorized`,
 * 403 `banned`.
 */
export const AddXpRequest = z
  .object({
    entries: z.array(XpEntry).min(1).max(XP_ENTRIES_PER_REQUEST),
  })
  .refine(
    (r) => new Set(r.entries.map((e) => e.runId)).size === r.entries.length,
    { message: "runId must be unique", path: ["entries"] }
  );
export type AddXpRequest = z.infer<typeof AddXpRequest>;

/**
 * What happened to one entry:
 * - `credited`: stored, `xp` added to the account (`breakdown` says why);
 * - `duplicate`: this run id was uploaded before; `xp` is what it brought then; nothing added;
 * - `flagged`: stored with 0 XP because it failed the plausibility check like a run report
 *   (`flagReason`: `too_fast`, `unknown_game_version`); a retry answers `duplicate`;
 * - `deferred`: not stored, the account reached XP_MAX_PER_DAY today; send it again later
 *   (after the next UTC midnight, see `AddXpResponse.dailyResetAt`).
 * The game drops the local entry for every status except `deferred`.
 */
export const XpEntryStatus = z.enum([
  "credited",
  "duplicate",
  "flagged",
  "deferred",
]);
export type XpEntryStatus = z.infer<typeof XpEntryStatus>;

export const XpEntryResult = z.object({
  runId: Uuid,
  status: XpEntryStatus,
  /** XP added by this entry (0 for `flagged` and `deferred`; the stored value for `duplicate`). */
  xp: z.number().int().min(0),
  /** For `credited` (and the would-be XP of `deferred`); null otherwise. */
  breakdown: XpBreakdown.nullable(),
  /** For `flagged` (and `duplicate` of a flagged entry); null otherwise. */
  flagReason: z.string().nullable(),
});
export type XpEntryResult = z.infer<typeof XpEntryResult>;

export const AddXpResponse = z.object({
  /** One result per request entry, same order. */
  entries: z.array(XpEntryResult),
  /** The account after this upload. */
  account: AccountLevel,
  /** XP the account can still get today (UTC) before entries are `deferred`. */
  dailyXpLeft: z.number().int().min(0),
  /** Next UTC midnight: when the daily cap starts again. */
  dailyResetAt: IsoDateTime,
});
export type AddXpResponse = z.infer<typeof AddXpResponse>;
