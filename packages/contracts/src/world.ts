import { z } from "zod";
import { IsoDateTime, Uuid } from "./common.ts";
import { ClientPlatform, GameVersion } from "./lobby.ts";

/**
 * Cloud worlds (D-188, KF8 = CP5; game repo docs/KONZEPT_KONTO_FORTSCHRITT.md §4, P-038). One
 * cloud world per local world (save format v5 with `[world] id`), offline first: the game always
 * plays from its local file, the server is the shared state between devices.
 *
 * Who merges (P-038): **the game** (KF9, `meta/save_merge.gd`). The server stores the blob with a
 * `revision` and never looks inside beyond the checks below. Every write names the revision it is
 * based on (`baseRevision` or `If-Match: "<revision>"`); a stale base answers 409
 * `revision_conflict` with the server state, the game merges both states by the field rules of the
 * concept (§4.3, no dialog), uploads the result with the new base and repeats if the server state
 * moved again. The state whose "last played" fields lost is kept as a backup for
 * WORLD_BACKUP_RETENTION_DAYS (`discarded`), restorable from the account panel.
 *
 * Content is untrusted: size, format, world id and summary are checked; it never feeds
 * leaderboards, the guild treasury or purchases.
 *
 * All numbers are TESTWERT (D-188).
 */

// --- numbers (TESTWERT, D-188) -------------------------------------------------------------------

/** Active cloud worlds per account (same as the game's local slots). */
export const MAX_CLOUD_WORLDS = 3;
/** Largest `data` blob in bytes (UTF-8 of its JSON). */
export const WORLD_MAX_DATA_BYTES = 65_536;
/** Largest body of PUT /me/worlds/:worldId (state + optional discarded local state + slack). */
export const WORLD_MAX_BODY_BYTES = 2 * WORLD_MAX_DATA_BYTES + 16_384;
/** Oldest save format with a world id (`[world] id`, v5); older files are migrated first. */
export const WORLD_MIN_FORMAT_VERSION = 5;
/** Days a backup (discarded or replaced state) stays restorable. */
export const WORLD_BACKUP_RETENTION_DAYS = 30;
/** Days an archived world stays before it is deleted. */
export const WORLD_ARCHIVE_RETENTION_DAYS = 30;
/** Backups kept per world; the oldest ones beyond this go first (pending merges never). */
export const WORLD_MAX_BACKUPS = 10;
/** `last_played` / `lastPlayedAt` more than this far ahead of the server clock = server time. */
export const WORLD_FUTURE_TOLERANCE_SECONDS = 300;
/** A cloud world with more play time than this makes an account "not empty" (D-188, merge). */
export const WORLD_EMPTY_PLAY_SECONDS = 300;

// --- the blob ------------------------------------------------------------------------------------

/** UUID the game gives a world once (`[world] id`, v5); the same world on every device. */
export const WorldId = Uuid;

const CONFIG_NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;

/**
 * The save file as JSON, one object per ConfigFile section: `{ "<section>": { "<key>": value } }`
 * (values any JSON; the game converts its types, e.g. PackedStringArray -> array). Rules checked by
 * the server: `world.id` equals the world id of the route, `meta.version` equals `formatVersion`,
 * at most WORLD_MAX_DATA_BYTES. The section `cloud` (local sync data, concept §4.3) is never
 * stored: the server drops it. `profile.last_played` / `profile.created` (unix seconds) more than
 * WORLD_FUTURE_TOLERANCE_SECONDS in the future are set to the server time.
 */
export const WorldData = z.record(
  z.string().regex(CONFIG_NAME, "invalid section name"),
  z.record(z.string().regex(CONFIG_NAME, "invalid key name"), z.json())
);
export type WorldData = z.infer<typeof WorldData>;

const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

/** What the world list shows without downloading the blob (concept §4.2). Filled by the game. */
export const WorldSummary = z.object({
  /** The world's own name (`[world] name`); "" = the game's default ("Welt 2"). */
  name: z.string().trim().max(32).regex(NO_CONTROL_CHARS, "no control chars"),
  /** Record: `[stats] deepest_room`. */
  deepestRoom: z.number().int().min(0).max(100_000),
  /** Forge levels bought (`SaveSlots.forge_progress`) and all levels ("Schmiede x/20"). */
  forgeLevel: z.number().int().min(0).max(1000),
  forgeMax: z.number().int().min(0).max(1000),
  /** `[stats] play_time`, whole seconds. */
  playTimeSeconds: z
    .number()
    .int()
    .min(0)
    .max(10 * 365 * 86_400),
  /** `[profile] last_played` as ISO time; future values beyond the tolerance = server time. */
  lastPlayedAt: IsoDateTime,
});
export type WorldSummary = z.infer<typeof WorldSummary>;

/** One uploadable state of a world: the blob plus what the server keeps next to it. */
export const WorldState = z.object({
  /** `[meta] version` of the blob (v5 or newer). */
  formatVersion: z.number().int().min(WORLD_MIN_FORMAT_VERSION).max(1000),
  gameVersion: GameVersion,
  platform: ClientPlatform,
  summary: WorldSummary,
  data: WorldData,
});
export type WorldState = z.infer<typeof WorldState>;

// --- metadata ------------------------------------------------------------------------------------

/**
 * `active` = one of the MAX_CLOUD_WORLDS synced worlds; `archived` = kept WORLD_ARCHIVE_RETENTION_DAYS
 * (`expiresAt`), restorable with POST /me/worlds/:worldId/unarchive.
 */
export const WorldStatus = z.enum(["active", "archived"]);
export type WorldStatus = z.infer<typeof WorldStatus>;

/**
 * How the current revision came about: `upload` (PUT), `restore` (a backup was restored) or
 * `account_merge` (two accounts were merged; see `pendingMerges`).
 */
export const WorldSource = z.enum(["upload", "restore", "account_merge"]);
export type WorldSource = z.infer<typeof WorldSource>;

/** A cloud world without its blob (lists, PUT answers). */
export const WorldMeta = z.object({
  worldId: WorldId,
  /** Starts at 1, +1 with every new state (PUT, restore, account merge); the ETag is `"<revision>"`. */
  revision: z.number().int().min(1),
  status: WorldStatus,
  source: WorldSource,
  formatVersion: z.number().int().min(1),
  gameVersion: z.string(),
  platform: ClientPlatform,
  summary: WorldSummary,
  /** Bytes of the stored blob. */
  sizeBytes: z.number().int().min(0),
  /** First upload of this world to this account. */
  createdAt: IsoDateTime,
  /** Last new revision or status change (server time). */
  updatedAt: IsoDateTime,
  /** When it went to the archive; null while active. */
  archivedAt: IsoDateTime.nullable(),
  /** When the archived world will be deleted; null while active. */
  expiresAt: IsoDateTime.nullable(),
  /** Restorable backups of this world. */
  backupCount: z.number().int().min(0),
  /**
   * Backup ids the game still has to merge in (after an account merge both accounts had this
   * world, D-188): GET each backup, merge it like a conflict, then PUT with `resolvedMerges`.
   */
  pendingMerges: z.array(Uuid),
});
export type WorldMeta = z.infer<typeof WorldMeta>;

/** A cloud world with its blob (GET /me/worlds/:worldId, conflicts, restores). */
export const CloudWorld = WorldMeta.extend({ data: WorldData });
export type CloudWorld = z.infer<typeof CloudWorld>;

/**
 * GET /me/worlds (player session): active worlds (most recently played first) and the archive
 * (newest first, expired ones left out). 200 always, also without any world.
 */
export const WorldList = z.object({
  items: z.array(WorldMeta),
  archived: z.array(WorldMeta),
  /** MAX_CLOUD_WORLDS of this server. */
  maxWorlds: z.number().int().min(1),
  /** WORLD_MAX_DATA_BYTES of this server. */
  maxDataBytes: z.number().int().min(1),
});
export type WorldList = z.infer<typeof WorldList>;

// --- PUT /me/worlds/:worldId ---------------------------------------------------------------------

/**
 * The state that lost the "last played" fields of a merge and stays as a backup (concept §4.3):
 * `server` = the server state this PUT replaces; `local` = the game's own state (sent along).
 */
export const DiscardedState = z.discriminatedUnion("side", [
  z.object({ side: z.literal("server") }),
  WorldState.extend({ side: z.literal("local") }),
]);
export type DiscardedState = z.infer<typeof DiscardedState>;

/**
 * PUT /me/worlds/:worldId (player session): uploads a new state.
 * - Base revision: `baseRevision` in the body or the header `If-Match: "<revision>"` (both = must
 *   agree); `0` (or `If-None-Match: *`) = the world is new on this account. One of them is required.
 * - Stale base → 409 `revision_conflict` (`WorldConflictResponse`, with the server state; `world`
 *   is null when the world no longer exists, then send `baseRevision: 0`).
 * - The written world is active. With more than MAX_CLOUD_WORLDS active worlds the least recently
 *   played one goes to the archive (possibly this one; `PutWorldResponse.archived`).
 * - An archived world written with its current revision becomes active again (it was played on).
 * - `discarded` keeps the losing state of a merge as a backup; `resolvedMerges` clears pending
 *   account-merge backups the game merged in.
 * Answer: 201 (new on this account) or 200 `PutWorldResponse`, header `ETag`. Errors: 400
 * `validation_error`, `invalid_revision` (If-Match unreadable or different from `baseRevision`),
 * `revision_required`, `world_id_mismatch` (`data.world.id`), `format_mismatch`
 * (`data.meta.version`); 409 `revision_conflict`; 413 `world_too_large` / `payload_too_large`;
 * 429 `rate_limited`; 401, 403 `banned`.
 */
export const PutWorldRequest = WorldState.extend({
  baseRevision: z.number().int().min(0).optional(),
  discarded: DiscardedState.optional(),
  /** Ids from `pendingMerges` that are merged into this state. */
  resolvedMerges: z.array(Uuid).max(50).optional(),
});
export type PutWorldRequest = z.infer<typeof PutWorldRequest>;

export const PutWorldResponse = z.object({
  world: WorldMeta,
  /** Worlds this write moved to the archive (the limit); may contain `world` itself. */
  archived: z.array(WorldMeta),
});
export type PutWorldResponse = z.infer<typeof PutWorldResponse>;

/** 409 of PUT / DELETE with a stale base: the current server state for the merge. */
export const WorldConflictResponse = z.object({
  error: z.literal("revision_conflict"),
  message: z.string().optional(),
  /** null = the world does not exist on this account (any more). */
  world: CloudWorld.nullable(),
});
export type WorldConflictResponse = z.infer<typeof WorldConflictResponse>;

/**
 * 409 of unarchive / restore when MAX_CLOUD_WORLDS worlds are active and no `archiveWorldId` was
 * given: the active worlds, so the account panel can offer which one to archive.
 */
export const WorldLimitResponse = z.object({
  error: z.literal("world_limit_reached"),
  message: z.string().optional(),
  items: z.array(WorldMeta),
});
export type WorldLimitResponse = z.infer<typeof WorldLimitResponse>;

// --- DELETE /me/worlds/:worldId ------------------------------------------------------------------

/**
 * DELETE /me/worlds/:worldId (player session), optional `If-Match: "<revision>"` (stale = 409
 * `revision_conflict`). Default: the world goes to the archive (WORLD_ARCHIVE_RETENTION_DAYS,
 * restorable) → 200 `DeleteWorldResponse`; already archived = unchanged. `?permanent=true` deletes
 * the world with all backups at once → 204. Errors: 404 `world_not_found`, 429 `rate_limited`.
 */
export const DeleteWorldQuery = z.object({
  permanent: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});
export type DeleteWorldQuery = z.infer<typeof DeleteWorldQuery>;

export const DeleteWorldResponse = z.object({ world: WorldMeta });
export type DeleteWorldResponse = z.infer<typeof DeleteWorldResponse>;

// --- backups and archive -------------------------------------------------------------------------

/**
 * Why a backup exists: `merge` (lost the "last played" fields of a merge, `discarded`),
 * `restore` (the state a restore replaced), `account_merge` (the other account's state of the
 * same world; `pendingMerge` until the game merged it in).
 */
export const WorldBackupReason = z.enum(["merge", "restore", "account_merge"]);
export type WorldBackupReason = z.infer<typeof WorldBackupReason>;

export const WorldBackupMeta = z.object({
  id: Uuid,
  worldId: WorldId,
  reason: WorldBackupReason,
  /** Server revision the state had; null for a discarded local state. */
  fromRevision: z.number().int().min(1).nullable(),
  /** true = account merge the game still has to merge in (listed in `WorldMeta.pendingMerges`). */
  pendingMerge: z.boolean(),
  formatVersion: z.number().int().min(1),
  gameVersion: z.string(),
  platform: ClientPlatform,
  summary: WorldSummary,
  sizeBytes: z.number().int().min(0),
  createdAt: IsoDateTime,
  /** Deleted after this (WORLD_BACKUP_RETENTION_DAYS). */
  expiresAt: IsoDateTime,
});
export type WorldBackupMeta = z.infer<typeof WorldBackupMeta>;

export const WorldBackup = WorldBackupMeta.extend({ data: WorldData });
export type WorldBackup = z.infer<typeof WorldBackup>;

/**
 * GET /me/worlds/:worldId/backups (player session): restorable backups, newest first. Also for
 * archived worlds. GET …/backups/:backupId answers `WorldBackup` (with the blob). 404
 * `world_not_found`, `backup_not_found`.
 */
export const WorldBackupList = z.object({ items: z.array(WorldBackupMeta) });
export type WorldBackupList = z.infer<typeof WorldBackupList>;

/**
 * POST /me/worlds/:worldId/backups/:backupId/restore and POST /me/worlds/:worldId/unarchive
 * (player session, body optional).
 * - Restore: the backup becomes the new revision (`source: restore`), uploaded "as new": its
 *   `last_played` is set to the server time, so the next merge on another device takes its "last
 *   played" fields (the merge rule does not undo the restore). The replaced state becomes a backup
 *   (`restore`), the restored backup stays.
 * - Unarchive: the archived world becomes active as it is (same revision).
 * Both make the world active: with MAX_CLOUD_WORLDS active worlds already, `archiveWorldId` names
 * the active world that goes to the archive instead, otherwise 409 `world_limit_reached`
 * (`WorldLimitResponse`). Answer 200 `RestoreWorldResponse`, header `ETag`. Errors: 404
 * `world_not_found`, `backup_not_found`; 400 `invalid_archive_world`; 429 `rate_limited`.
 */
export const RestoreWorldRequest = z.object({
  archiveWorldId: WorldId.optional(),
});
export type RestoreWorldRequest = z.infer<typeof RestoreWorldRequest>;

export const RestoreWorldResponse = z.object({
  /** The world now (with the blob, so the game can write its local file directly). */
  world: CloudWorld,
  /** The world `archiveWorldId` moved to the archive, else empty. */
  archived: z.array(WorldMeta),
});
export type RestoreWorldResponse = z.infer<typeof RestoreWorldResponse>;
