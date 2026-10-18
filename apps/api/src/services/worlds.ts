import {
  type ClientPlatform,
  type CloudWorld,
  type DiscardedState,
  MAX_CLOUD_WORLDS,
  type PutWorldResponse,
  type RestoreWorldResponse,
  WORLD_ARCHIVE_RETENTION_DAYS,
  WORLD_BACKUP_RETENTION_DAYS,
  WORLD_EMPTY_PLAY_SECONDS,
  WORLD_FUTURE_TOLERANCE_SECONDS,
  WORLD_MAX_BACKUPS,
  WORLD_MAX_DATA_BYTES,
  type WorldBackup,
  type WorldBackupMeta,
  type WorldBackupReason,
  type WorldData,
  type WorldList,
  type WorldMeta,
  type WorldState,
  type WorldSummary,
} from "@soulwick/contracts";
import type {
  CloudWorldBackup as BackupRow,
  Prisma,
  CloudWorld as WorldRow,
} from "@soulwick/db";
import { ApiError } from "../lib/errors.ts";
import { forEachSequential } from "../lib/sequential.ts";
import { iso, isoOrNull } from "../lib/validate.ts";
import type { Db, DbOrTx, Tx } from "./db-types.ts";

/**
 * Cloud worlds (D-188, KF8, P-038; contract world.ts). The server keeps one blob per world and
 * account with a revision, backups and an archive; it never merges. A write with a stale base
 * revision fails with 409 `revision_conflict` and the server state, the game merges
 * (`meta/save_merge.gd`, KF9) and uploads again. Every write locks the player row, so the
 * revision check, the limit of MAX_CLOUD_WORLDS active worlds and the backups stay consistent
 * when two devices sync at once.
 */

const DAY_MS = 86_400_000;

// --- errors --------------------------------------------------------------------------------------

const worldNotFound = () =>
  new ApiError(404, "world_not_found", "World not found");
const backupNotFound = () =>
  new ApiError(404, "backup_not_found", "Backup not found");
const conflict = (world: CloudWorld | null) =>
  new ApiError(
    409,
    "revision_conflict",
    "The world changed on the server; merge and upload again",
    { world }
  );

// --- preparing an uploaded state -----------------------------------------------------------------

/** Columns shared by `cloud_worlds` and `cloud_world_backups` that describe one state. */
interface StateColumns {
  data: Prisma.InputJsonObject;
  deepestRoom: number;
  forgeLevel: number;
  forgeMax: number;
  formatVersion: number;
  gameVersion: string;
  lastPlayedAt: Date;
  name: string;
  platform: string;
  playTimeSeconds: number;
  sizeBytes: number;
}

const byteLength = (data: unknown) =>
  Buffer.byteLength(JSON.stringify(data), "utf8");

/**
 * Checks an uploaded state and turns it into columns: drops the local `cloud` section, requires
 * `world.id` = the route's world id and `meta.version` = `formatVersion`, sets `profile.last_played`
 * / `profile.created` and `summary.lastPlayedAt` from the future to the server time, enforces
 * WORLD_MAX_DATA_BYTES.
 */
export function prepareState(
  worldId: string,
  state: WorldState,
  now: Date
): StateColumns {
  const { cloud: _local, ...data } = state.data;
  const worldSection = data.world;
  if (
    typeof worldSection?.id !== "string" ||
    worldSection.id.toLowerCase() !== worldId.toLowerCase()
  ) {
    throw new ApiError(
      400,
      "world_id_mismatch",
      "data.world.id must be the world id of the route"
    );
  }
  if (data.meta?.version !== state.formatVersion) {
    throw new ApiError(
      400,
      "format_mismatch",
      "data.meta.version must equal formatVersion"
    );
  }
  const limitMs = now.getTime() + WORLD_FUTURE_TOLERANCE_SECONDS * 1000;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const profile = data.profile;
  if (profile) {
    const capped = { ...profile };
    for (const key of ["last_played", "created"]) {
      const value = capped[key];
      if (typeof value === "number" && value * 1000 > limitMs) {
        capped[key] = nowSeconds;
      }
    }
    data.profile = capped;
  }
  const sizeBytes = byteLength(data);
  if (sizeBytes > WORLD_MAX_DATA_BYTES) {
    throw new ApiError(
      413,
      "world_too_large",
      `The world data must be at most ${WORLD_MAX_DATA_BYTES} bytes`,
      { sizeBytes, maxDataBytes: WORLD_MAX_DATA_BYTES }
    );
  }
  const lastPlayed = new Date(state.summary.lastPlayedAt);
  return {
    data: data as Prisma.InputJsonObject,
    sizeBytes,
    formatVersion: state.formatVersion,
    gameVersion: state.gameVersion,
    platform: state.platform,
    name: state.summary.name,
    deepestRoom: state.summary.deepestRoom,
    forgeLevel: state.summary.forgeLevel,
    forgeMax: state.summary.forgeMax,
    playTimeSeconds: state.summary.playTimeSeconds,
    lastPlayedAt: lastPlayed.getTime() > limitMs ? now : lastPlayed,
  };
}

const columnsOf = (row: WorldRow | BackupRow): StateColumns => ({
  data: row.data as Prisma.InputJsonObject,
  sizeBytes: row.sizeBytes,
  formatVersion: row.formatVersion,
  gameVersion: row.gameVersion,
  platform: row.platform,
  name: row.name,
  deepestRoom: row.deepestRoom,
  forgeLevel: row.forgeLevel,
  forgeMax: row.forgeMax,
  playTimeSeconds: row.playTimeSeconds,
  lastPlayedAt: row.lastPlayedAt,
});

// --- rows to contract ----------------------------------------------------------------------------

const summaryOf = (row: WorldRow | BackupRow): WorldSummary => ({
  name: row.name,
  deepestRoom: row.deepestRoom,
  forgeLevel: row.forgeLevel,
  forgeMax: row.forgeMax,
  playTimeSeconds: row.playTimeSeconds,
  lastPlayedAt: iso(row.lastPlayedAt),
});

/** Restorable backups of these worlds (not expired), for `backupCount` and `pendingMerges`. */
async function backupStats(db: DbOrTx, worldRowIds: string[], now: Date) {
  const rows = await db.cloudWorldBackup.findMany({
    where: { cloudWorldId: { in: worldRowIds }, expiresAt: { gt: now } },
    select: { id: true, cloudWorldId: true, pendingMerge: true },
    orderBy: { createdAt: "asc" },
  });
  const stats = new Map<string, { count: number; pending: string[] }>();
  for (const row of rows) {
    const entry = stats.get(row.cloudWorldId) ?? { count: 0, pending: [] };
    entry.count += 1;
    if (row.pendingMerge) {
      entry.pending.push(row.id);
    }
    stats.set(row.cloudWorldId, entry);
  }
  return stats;
}

function toMeta(
  row: WorldRow,
  stats: { count: number; pending: string[] } | undefined
): WorldMeta {
  return {
    worldId: row.worldId,
    revision: row.revision,
    status: row.status,
    source: row.source,
    formatVersion: row.formatVersion,
    gameVersion: row.gameVersion,
    platform: row.platform as ClientPlatform,
    summary: summaryOf(row),
    sizeBytes: row.sizeBytes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: isoOrNull(row.archivedAt),
    expiresAt: isoOrNull(row.expiresAt),
    backupCount: stats?.count ?? 0,
    pendingMerges: stats?.pending ?? [],
  };
}

async function metasOf(
  db: DbOrTx,
  rows: WorldRow[],
  now: Date
): Promise<WorldMeta[]> {
  const stats = await backupStats(
    db,
    rows.map((r) => r.id),
    now
  );
  return rows.map((row) => toMeta(row, stats.get(row.id)));
}

async function toCloudWorld(
  db: DbOrTx,
  row: WorldRow,
  now: Date
): Promise<CloudWorld> {
  const [meta] = await metasOf(db, [row], now);
  if (!meta) {
    throw worldNotFound();
  }
  return { ...meta, data: row.data as WorldData };
}

const toBackupMeta = (row: BackupRow, worldId: string): WorldBackupMeta => ({
  id: row.id,
  worldId,
  reason: row.reason,
  fromRevision: row.fromRevision,
  pendingMerge: row.pendingMerge,
  formatVersion: row.formatVersion,
  gameVersion: row.gameVersion,
  platform: row.platform as ClientPlatform,
  summary: summaryOf(row),
  sizeBytes: row.sizeBytes,
  createdAt: iso(row.createdAt),
  expiresAt: iso(row.expiresAt),
});

// --- shared steps --------------------------------------------------------------------------------

/** Active, or archived and not yet expired (housekeeping may not have run yet). */
const visible = (now: Date): Prisma.CloudWorldWhereInput => ({
  OR: [{ status: "active" }, { expiresAt: { gt: now } }],
});

async function lockPlayer(tx: Tx, playerId: string) {
  await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
}

/** Deletes expired backups and archived worlds of one account (the job does it for everyone). */
async function purgeExpired(tx: Tx, playerId: string, now: Date) {
  await tx.cloudWorldBackup.deleteMany({
    where: { expiresAt: { lte: now }, world: { playerId } },
  });
  await tx.cloudWorld.deleteMany({
    where: { playerId, status: "archived", expiresAt: { lte: now } },
  });
}

async function archiveRows(tx: Tx, ids: string[], now: Date) {
  if (ids.length === 0) {
    return;
  }
  await tx.cloudWorld.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "archived",
      archivedAt: now,
      expiresAt: new Date(
        now.getTime() + WORLD_ARCHIVE_RETENTION_DAYS * DAY_MS
      ),
      updatedAt: now,
    },
  });
}

/**
 * The limit for sync writes and account merges: beyond MAX_CLOUD_WORLDS active worlds the least
 * recently played ones go to the archive (concept §4.4). Returns the row ids it archived.
 */
async function enforceLimit(
  tx: Tx,
  playerId: string,
  now: Date
): Promise<string[]> {
  const active = await tx.cloudWorld.findMany({
    where: { playerId, status: "active" },
    orderBy: [{ lastPlayedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const overflow = active.slice(MAX_CLOUD_WORLDS).map((r) => r.id);
  await archiveRows(tx, overflow, now);
  return overflow;
}

/**
 * For explicit actions (unarchive, restore of an archived world): room for one more active world.
 * Full → archives `archiveWorldId` (one of the other active worlds) or answers 409
 * `world_limit_reached` with the active worlds. Returns the row ids it archived.
 */
async function makeRoom(
  tx: Tx,
  input: {
    playerId: string;
    world: WorldRow;
    archiveWorldId: string | undefined;
    now: Date;
  }
): Promise<string[]> {
  const { playerId, world, archiveWorldId, now } = input;
  if (world.status === "active") {
    return [];
  }
  const active = await tx.cloudWorld.findMany({
    where: { playerId, status: "active" },
    orderBy: [{ lastPlayedAt: "desc" }, { updatedAt: "desc" }],
  });
  if (active.length < MAX_CLOUD_WORLDS) {
    return [];
  }
  if (!archiveWorldId) {
    throw new ApiError(
      409,
      "world_limit_reached",
      `At most ${MAX_CLOUD_WORLDS} worlds can be active; name one to archive`,
      { items: await metasOf(tx, active, now) }
    );
  }
  const target = active.find(
    (r) => r.worldId.toLowerCase() === archiveWorldId.toLowerCase()
  );
  if (!target || target.id === world.id) {
    throw new ApiError(
      400,
      "invalid_archive_world",
      "archiveWorldId must be another active world of this account"
    );
  }
  // Only as many as needed to get below the limit (normally exactly this one).
  await archiveRows(tx, [target.id], now);
  return [target.id];
}

async function createBackup(
  tx: Tx,
  input: {
    cloudWorldId: string;
    reason: WorldBackupReason;
    fromRevision: number | null;
    state: StateColumns;
    pendingMerge?: boolean;
    now: Date;
  }
) {
  await tx.cloudWorldBackup.create({
    data: {
      cloudWorldId: input.cloudWorldId,
      reason: input.reason,
      fromRevision: input.fromRevision,
      pendingMerge: input.pendingMerge ?? false,
      ...input.state,
      createdAt: input.now,
      expiresAt: new Date(
        input.now.getTime() + WORLD_BACKUP_RETENTION_DAYS * DAY_MS
      ),
    },
  });
}

/** Keeps the WORLD_MAX_BACKUPS newest backups of a world; pending merges always stay. */
async function pruneBackups(tx: Tx, cloudWorldId: string) {
  const old = await tx.cloudWorldBackup.findMany({
    where: { cloudWorldId, pendingMerge: false },
    orderBy: { createdAt: "desc" },
    skip: WORLD_MAX_BACKUPS,
    select: { id: true },
  });
  if (old.length > 0) {
    await tx.cloudWorldBackup.deleteMany({
      where: { id: { in: old.map((r) => r.id) } },
    });
  }
}

async function findWorld(
  db: DbOrTx,
  playerId: string,
  worldId: string,
  now: Date
): Promise<WorldRow> {
  const row = await db.cloudWorld.findFirst({
    where: { playerId, worldId, ...visible(now) },
  });
  if (!row) {
    throw worldNotFound();
  }
  return row;
}

async function rowsById(tx: Tx, ids: string[]) {
  const rows = await tx.cloudWorld.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

// --- routes --------------------------------------------------------------------------------------

/** GET /me/worlds. */
export async function listWorlds(
  db: Db,
  playerId: string,
  now: Date
): Promise<WorldList> {
  const rows = await db.cloudWorld.findMany({
    where: { playerId, ...visible(now) },
    orderBy: [{ lastPlayedAt: "desc" }, { updatedAt: "desc" }],
  });
  const metas = await metasOf(db, rows, now);
  const archived = metas
    .filter((m) => m.status === "archived")
    .toSorted((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  return {
    items: metas.filter((m) => m.status === "active"),
    archived,
    maxWorlds: MAX_CLOUD_WORLDS,
    maxDataBytes: WORLD_MAX_DATA_BYTES,
  };
}

/** GET /me/worlds/:worldId. */
export async function getWorld(
  db: Db,
  playerId: string,
  worldId: string,
  now: Date
): Promise<CloudWorld> {
  return await toCloudWorld(
    db,
    await findWorld(db, playerId, worldId, now),
    now
  );
}

/**
 * PUT /me/worlds/:worldId: see PutWorldRequest. `created` = the world is new on this account.
 */
export async function putWorld(
  db: Db,
  input: {
    playerId: string;
    worldId: string;
    baseRevision: number;
    state: WorldState;
    discarded?: DiscardedState;
    resolvedMerges?: string[];
    now: Date;
  }
): Promise<{ created: boolean; response: PutWorldResponse }> {
  const { playerId, worldId, baseRevision, now } = input;
  const state = prepareState(worldId, input.state, now);
  const discardedLocal =
    input.discarded?.side === "local"
      ? prepareState(worldId, input.discarded, now)
      : null;

  return await db.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await purgeExpired(tx, playerId, now);
    const existing = await tx.cloudWorld.findUnique({
      where: { playerId_worldId: { playerId, worldId } },
    });
    if (!existing) {
      if (baseRevision !== 0) {
        throw conflict(null);
      }
    } else if (existing.revision !== baseRevision) {
      throw conflict(await toCloudWorld(tx, existing, now));
    }

    if (existing && input.discarded?.side === "server") {
      await createBackup(tx, {
        cloudWorldId: existing.id,
        reason: "merge",
        fromRevision: existing.revision,
        state: columnsOf(existing),
        now,
      });
    }
    const fields = {
      ...state,
      status: "active" as const,
      source: "upload" as const,
      archivedAt: null,
      expiresAt: null,
      updatedAt: now,
    };
    const row = existing
      ? await tx.cloudWorld.update({
          where: { id: existing.id },
          data: { ...fields, revision: existing.revision + 1 },
        })
      : await tx.cloudWorld.create({
          data: { ...fields, playerId, worldId, revision: 1, createdAt: now },
        });
    if (discardedLocal) {
      await createBackup(tx, {
        cloudWorldId: row.id,
        reason: "merge",
        fromRevision: null,
        state: discardedLocal,
        now,
      });
    }
    if (input.resolvedMerges && input.resolvedMerges.length > 0) {
      await tx.cloudWorldBackup.updateMany({
        where: { id: { in: input.resolvedMerges }, cloudWorldId: row.id },
        data: { pendingMerge: false },
      });
    }
    const archivedIds = await enforceLimit(tx, playerId, now);
    await pruneBackups(tx, row.id);

    const [world, ...archived] = await metasOf(
      tx,
      await rowsById(tx, [
        row.id,
        ...archivedIds.filter((id) => id !== row.id),
      ]),
      now
    );
    if (!world) {
      throw worldNotFound();
    }
    const archivedMetas = archivedIds.includes(row.id)
      ? [world, ...archived]
      : archived;
    return {
      created: !existing,
      response: { world, archived: archivedMetas },
    };
  });
}

/**
 * DELETE /me/worlds/:worldId: archives the world (null = deleted for good with `permanent`).
 * `ifRevision` (If-Match) must match the current revision when given.
 */
export async function deleteWorld(
  db: Db,
  input: {
    playerId: string;
    worldId: string;
    ifRevision: number | null;
    permanent: boolean;
    now: Date;
  }
): Promise<WorldMeta | null> {
  const { playerId, worldId, ifRevision, permanent, now } = input;
  return await db.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await purgeExpired(tx, playerId, now);
    const row = await findWorld(tx, playerId, worldId, now);
    if (ifRevision !== null && ifRevision !== row.revision) {
      throw conflict(await toCloudWorld(tx, row, now));
    }
    if (permanent) {
      await tx.cloudWorld.delete({ where: { id: row.id } });
      return null;
    }
    if (row.status === "active") {
      await archiveRows(tx, [row.id], now);
    }
    const [meta] = await metasOf(tx, await rowsById(tx, [row.id]), now);
    if (!meta) {
      throw worldNotFound();
    }
    return meta;
  });
}

/** GET /me/worlds/:worldId/backups. */
export async function listBackups(
  db: Db,
  playerId: string,
  worldId: string,
  now: Date
): Promise<WorldBackupMeta[]> {
  const world = await findWorld(db, playerId, worldId, now);
  const rows = await db.cloudWorldBackup.findMany({
    where: { cloudWorldId: world.id, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => toBackupMeta(row, world.worldId));
}

async function findBackup(
  db: DbOrTx,
  world: WorldRow,
  backupId: string,
  now: Date
): Promise<BackupRow> {
  const row = await db.cloudWorldBackup.findFirst({
    where: { id: backupId, cloudWorldId: world.id, expiresAt: { gt: now } },
  });
  if (!row) {
    throw backupNotFound();
  }
  return row;
}

/** GET /me/worlds/:worldId/backups/:backupId. */
export async function getBackup(
  db: Db,
  input: { playerId: string; worldId: string; backupId: string; now: Date }
): Promise<WorldBackup> {
  const world = await findWorld(db, input.playerId, input.worldId, input.now);
  const row = await findBackup(db, world, input.backupId, input.now);
  return { ...toBackupMeta(row, world.worldId), data: row.data as WorldData };
}

/** The restored state is "new": its last played time becomes the server time (P-038). */
function asRestored(state: StateColumns, now: Date): StateColumns {
  const data = { ...(state.data as Record<string, Record<string, unknown>>) };
  if (data.profile) {
    data.profile = {
      ...data.profile,
      last_played: Math.floor(now.getTime() / 1000),
    };
  }
  return {
    ...state,
    data: data as Prisma.InputJsonObject,
    sizeBytes: byteLength(data),
    lastPlayedAt: now,
  };
}

async function restoreResponse(
  tx: Tx,
  rowId: string,
  archivedIds: string[],
  now: Date
): Promise<RestoreWorldResponse> {
  const [row] = await rowsById(tx, [rowId]);
  if (!row) {
    throw worldNotFound();
  }
  return {
    world: await toCloudWorld(tx, row, now),
    archived: await metasOf(tx, await rowsById(tx, archivedIds), now),
  };
}

/** POST /me/worlds/:worldId/backups/:backupId/restore: see RestoreWorldRequest. */
export async function restoreBackup(
  db: Db,
  input: {
    playerId: string;
    worldId: string;
    backupId: string;
    archiveWorldId?: string;
    now: Date;
  }
): Promise<RestoreWorldResponse> {
  const { playerId, worldId, backupId, archiveWorldId, now } = input;
  return await db.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await purgeExpired(tx, playerId, now);
    const world = await findWorld(tx, playerId, worldId, now);
    const backup = await findBackup(tx, world, backupId, now);
    const archivedIds = await makeRoom(tx, {
      playerId,
      world,
      archiveWorldId,
      now,
    });
    await createBackup(tx, {
      cloudWorldId: world.id,
      reason: "restore",
      fromRevision: world.revision,
      state: columnsOf(world),
      now,
    });
    await tx.cloudWorld.update({
      where: { id: world.id },
      data: {
        ...asRestored(columnsOf(backup), now),
        revision: world.revision + 1,
        source: "restore",
        status: "active",
        archivedAt: null,
        expiresAt: null,
        updatedAt: now,
      },
    });
    await pruneBackups(tx, world.id);
    return await restoreResponse(tx, world.id, archivedIds, now);
  });
}

/** POST /me/worlds/:worldId/unarchive: see RestoreWorldRequest. */
export async function unarchiveWorld(
  db: Db,
  input: {
    playerId: string;
    worldId: string;
    archiveWorldId?: string;
    now: Date;
  }
): Promise<RestoreWorldResponse> {
  const { playerId, worldId, archiveWorldId, now } = input;
  return await db.$transaction(async (tx) => {
    await lockPlayer(tx, playerId);
    await purgeExpired(tx, playerId, now);
    const world = await findWorld(tx, playerId, worldId, now);
    const archivedIds = await makeRoom(tx, {
      playerId,
      world,
      archiveWorldId,
      now,
    });
    if (world.status === "archived") {
      await tx.cloudWorld.update({
        where: { id: world.id },
        data: {
          status: "active",
          archivedAt: null,
          expiresAt: null,
          updatedAt: now,
        },
      });
    }
    return await restoreResponse(tx, world.id, archivedIds, now);
  });
}

// --- account merge, progress, housekeeping -------------------------------------------------------

/** What an account merge did with the cloud worlds (logged only). */
export interface WorldMergeCounts {
  /** Active worlds that went to the archive because of the limit. */
  archived: number;
  /** Worlds both accounts had: one row stays, the other state is a pending-merge backup. */
  joined: number;
  /** Worlds that moved over as they were. */
  moved: number;
}

/**
 * Merge (D-122, D-188 §3.4): the cloud worlds of `dropId` move to `keepId`. A world id both
 * accounts know stays one row: the later played state is the world (new revision, `source:
 * account_merge`, active if either was), the other state becomes a backup with `pendingMerge`,
 * which the game merges in on its next sync (the server never merges blobs, P-038); backups of
 * both rows stay. Then the limit archives the least recently played active worlds. Runs inside
 * the caller's transaction with both player rows locked.
 */
export async function mergeWorlds(
  tx: Tx,
  keepId: string,
  dropId: string,
  now: Date
): Promise<WorldMergeCounts> {
  await purgeExpired(tx, keepId, now);
  await purgeExpired(tx, dropId, now);
  const keepRows = new Map(
    (await tx.cloudWorld.findMany({ where: { playerId: keepId } })).map((r) => [
      r.worldId,
      r,
    ])
  );
  const dropRows = await tx.cloudWorld.findMany({
    where: { playerId: dropId },
  });
  const counts: WorldMergeCounts = { joined: 0, moved: 0, archived: 0 };
  // One after the other: each step moves rows the next one may look at.
  await forEachSequential(dropRows, async (drop) => {
    const keep = keepRows.get(drop.worldId);
    if (!keep) {
      await tx.cloudWorld.update({
        where: { id: drop.id },
        data: { playerId: keepId },
      });
      counts.moved += 1;
      return;
    }
    counts.joined += 1;
    await tx.cloudWorldBackup.updateMany({
      where: { cloudWorldId: drop.id },
      data: { cloudWorldId: keep.id },
    });
    const dropWins = drop.lastPlayedAt > keep.lastPlayedAt;
    const winner = dropWins ? drop : keep;
    const loser = dropWins ? keep : drop;
    await createBackup(tx, {
      cloudWorldId: keep.id,
      reason: "account_merge",
      fromRevision: loser.revision,
      state: columnsOf(loser),
      pendingMerge: true,
      now,
    });
    const active = keep.status === "active" || drop.status === "active";
    await tx.cloudWorld.delete({ where: { id: drop.id } });
    await tx.cloudWorld.update({
      where: { id: keep.id },
      data: {
        ...columnsOf(winner),
        revision: Math.max(keep.revision, drop.revision) + 1,
        source: "account_merge",
        createdAt:
          drop.createdAt < keep.createdAt ? drop.createdAt : keep.createdAt,
        updatedAt: now,
        ...(active
          ? { status: "active", archivedAt: null, expiresAt: null }
          : {}),
      },
    });
  });
  counts.archived = (await enforceLimit(tx, keepId, now)).length;
  return counts;
}

/**
 * Cloud worlds of an account for the merge summary: `count` (active and archived) and whether one
 * has more than WORLD_EMPTY_PLAY_SECONDS play time (= progress, D-188 "empty account").
 */
export async function worldProgress(
  db: DbOrTx,
  playerId: string,
  now: Date
): Promise<{ count: number; hasProgress: boolean }> {
  const where = { playerId, ...visible(now) };
  const count = await db.cloudWorld.count({ where });
  const played =
    count === 0
      ? 0
      : await db.cloudWorld.count({
          where: {
            ...where,
            playTimeSeconds: { gt: WORLD_EMPTY_PLAY_SECONDS },
          },
        });
  return { count, hasProgress: played > 0 };
}

/** Housekeeping: expired backups (WORLD_BACKUP_RETENTION_DAYS) and archived worlds. */
export async function deleteExpiredWorldData(
  db: Db,
  now: Date
): Promise<{ backups: number; worlds: number }> {
  const backups = await db.cloudWorldBackup.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  const worlds = await db.cloudWorld.deleteMany({
    where: { status: "archived", expiresAt: { lte: now } },
  });
  return { backups: backups.count, worlds: worlds.count };
}
