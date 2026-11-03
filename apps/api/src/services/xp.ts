import {
  type AccountDanger,
  type AddXpResponse,
  accountDanger,
  accountLevel,
  DANGER_RECENT_RUNS,
  levelForXp,
  runXp,
  XP_FUTURE_TOLERANCE_SECONDS,
  XP_MAX_PER_DAY,
  type XpEntry,
  type XpEntryResult,
  xpDayOf,
} from "@soulwick/contracts";
import { Prisma } from "@soulwick/db";
import type { Config } from "../config.ts";
import type { Db, DbOrTx, Tx } from "./db-types.ts";
import { checkPlausibility } from "./plausibility.ts";

/**
 * Account XP (D-188, KF3; Konzept Konto und Fortschritt §5). The game uploads the counts of its
 * own runs; this service computes the XP with `runXp` from the contract, grants the account
 * record bonus and the first run of the day from the account's stored entries, applies the
 * plausibility check of run reports and the daily cap, and keeps `players.xp` (the sum of the
 * entries) in step. The level is always derived (`accountLevel`), never stored; so are the danger
 * level and the rank (D-194, KF3b: `accountDangers` from the level and the newest entries).
 */

const DAY_MS = 86_400_000;

const startOfUtcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/** XP credited to the account since the start of the current UTC day (flagged entries are 0). */
async function creditedToday(tx: Tx, playerId: string, now: Date) {
  const sum = await tx.xpEntry.aggregate({
    where: { playerId, createdAt: { gte: startOfUtcDay(now) } },
    _sum: { xp: true },
  });
  return sum._sum.xp ?? 0;
}

/**
 * POST /me/xp: processes the entries in the order sent, in one transaction with the player row
 * locked (parallel uploads of the same account cannot both pass the daily cap or credit a run id
 * twice). See `XpEntryResult` for the four outcomes.
 */
export async function addXp(
  db: Db,
  input: {
    playerId: string;
    entries: readonly XpEntry[];
    config: Pick<Config, "MIN_SECONDS_PER_ROOM" | "KNOWN_GAME_VERSIONS">;
    now: Date;
  }
): Promise<AddXpResponse> {
  const { playerId, entries, config, now } = input;
  return await db.$transaction(async (tx) => {
    await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;

    const runIds = entries.map((e) => e.runId);
    const known = new Map(
      (
        await tx.xpEntry.findMany({
          where: { playerId, runId: { in: runIds } },
          select: { runId: true, xp: true, flagReason: true },
        })
      ).map((row) => [row.runId, row])
    );
    const record = await tx.xpEntry.aggregate({
      where: { playerId, flagReason: null },
      _max: { deepestRoom: true },
    });
    let accountRecord = record._max.deepestRoom ?? 0;

    const endedAtOf = (e: XpEntry) => {
      const at = new Date(e.endedAt);
      return at.getTime() > now.getTime() + XP_FUTURE_TOLERANCE_SECONDS * 1000
        ? now
        : at;
    };
    const days = [...new Set(entries.map((e) => xpDayOf(endedAtOf(e))))];
    const bonusDays = new Set(
      (
        await tx.xpEntry.findMany({
          where: {
            playerId,
            firstRunOfDay: true,
            day: { in: days.map((d) => new Date(`${d}T00:00:00Z`)) },
          },
          select: { day: true },
        })
      ).map((row) => xpDayOf(row.day))
    );
    let dailyLeft = Math.max(
      0,
      XP_MAX_PER_DAY - (await creditedToday(tx, playerId, now))
    );

    const rows: Prisma.XpEntryCreateManyInput[] = [];
    let gained = 0;
    const results = entries.map((entry): XpEntryResult => {
      const stored = known.get(entry.runId);
      if (stored) {
        return {
          runId: entry.runId,
          status: "duplicate",
          xp: stored.xp,
          breakdown: null,
          flagReason: stored.flagReason,
        };
      }
      const endedAt = endedAtOf(entry);
      const day = xpDayOf(endedAt);
      const base = {
        playerId,
        runId: entry.runId,
        rooms: entry.rooms,
        champions: entry.champions,
        bosses: entry.bosses,
        deepestRoom: entry.deepestRoom,
        endReason: entry.endReason,
        players: entry.players,
        danger: entry.danger ?? 0,
        durationSeconds: entry.durationSeconds,
        gameVersion: entry.gameVersion,
        endedAt,
        day: new Date(`${day}T00:00:00Z`),
        createdAt: now,
      };
      const flagReason = checkPlausibility(
        {
          roomReached: Math.max(entry.rooms, entry.deepestRoom),
          durationSeconds: entry.durationSeconds,
          gameVersion: entry.gameVersion,
        },
        config
      );
      if (flagReason) {
        rows.push({
          ...base,
          xp: 0,
          recordRooms: 0,
          firstRunOfDay: false,
          flagReason,
        });
        return {
          runId: entry.runId,
          status: "flagged",
          xp: 0,
          breakdown: null,
          flagReason,
        };
      }
      const recordRooms = Math.max(0, entry.deepestRoom - accountRecord);
      const firstRunOfDay = !bonusDays.has(day);
      const breakdown = runXp({
        rooms: entry.rooms,
        champions: entry.champions,
        bosses: entry.bosses,
        recordRooms,
        endReason: entry.endReason,
        firstRunOfDay,
        players: entry.players,
        danger: entry.danger ?? 0,
      });
      if (breakdown.total > dailyLeft) {
        return {
          runId: entry.runId,
          status: "deferred",
          xp: 0,
          breakdown,
          flagReason: null,
        };
      }
      accountRecord = Math.max(accountRecord, entry.deepestRoom);
      if (firstRunOfDay) {
        bonusDays.add(day);
      }
      dailyLeft -= breakdown.total;
      gained += breakdown.total;
      rows.push({
        ...base,
        xp: breakdown.total,
        recordRooms,
        firstRunOfDay,
        flagReason: null,
      });
      return {
        runId: entry.runId,
        status: "credited",
        xp: breakdown.total,
        breakdown,
        flagReason: null,
      };
    });

    if (rows.length > 0) {
      await tx.xpEntry.createMany({ data: rows });
    }
    const player = await tx.player.update({
      where: { id: playerId },
      data: gained > 0 ? { xp: { increment: gained } } : {},
      select: { xp: true },
    });
    return {
      entries: results,
      account: accountLevel(player.xp),
      dailyXpLeft: dailyLeft,
      dailyResetAt: new Date(
        startOfUtcDay(now).getTime() + DAY_MS
      ).toISOString(),
    };
  });
}

/**
 * Merge (D-122, D-188): the XP entries of `dropId` move to `keepId`; a run id both accounts know
 * stays once (keep's row). `players.xp` of keep becomes the sum of its entries. Runs inside the
 * caller's transaction with both player rows locked.
 */
export async function mergeXp(
  tx: Tx,
  keepId: string,
  dropId: string
): Promise<void> {
  await tx.$executeRaw`
    delete from xp_entries d
    using xp_entries k
    where d.player_id = ${dropId}::uuid
      and k.player_id = ${keepId}::uuid
      and d.run_id = k.run_id`;
  await tx.xpEntry.updateMany({
    where: { playerId: dropId },
    data: { playerId: keepId },
  });
  const sum = await tx.xpEntry.aggregate({
    where: { playerId: keepId },
    _sum: { xp: true },
  });
  await tx.player.update({
    where: { id: keepId },
    data: { xp: sum._sum.xp ?? 0 },
  });
}

// --- danger level and rank (D-194, D-196, KF3b) ----------------------------------------------------

/** One of the newest XP entries of an account (skill part of the danger level). */
export interface RecentRunRow {
  danger: number;
  deepestRoom: number;
  endedAt: Date;
  runId: string;
}

/**
 * The newest DANGER_RECENT_RUNS XP entries per player, newest first (by `ended_at`, then upload
 * time). Flagged entries do not count: an implausible run must not move the rank. Every id gets
 * an entry in the map (empty list without runs).
 */
export async function recentRuns(
  db: DbOrTx,
  playerIds: readonly string[]
): Promise<Map<string, RecentRunRow[]>> {
  const ids = [...new Set(playerIds)];
  const result = new Map<string, RecentRunRow[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) {
    return result;
  }
  const rows = await db.$queryRaw<
    {
      danger: number;
      deepest_room: number;
      ended_at: Date;
      player_id: string;
      run_id: string;
    }[]
  >`
    select p.id::text as player_id, e.run_id::text as run_id, e.deepest_room, e.danger, e.ended_at
    from unnest(array[${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}]) as p(id)
    cross join lateral (
      select x.run_id, x.deepest_room, x.danger, x.ended_at, x.created_at
      from xp_entries x
      where x.player_id = p.id and x.flag_reason is null
      order by x.ended_at desc, x.created_at desc, x.run_id desc
      limit ${DANGER_RECENT_RUNS}
    ) e
    order by p.id, e.ended_at desc, e.created_at desc, e.run_id desc`;
  for (const row of rows) {
    result.get(row.player_id)?.push({
      runId: row.run_id,
      deepestRoom: Number(row.deepest_room),
      danger: Number(row.danger),
      endedAt: new Date(row.ended_at),
    });
  }
  return result;
}

/** Danger level and rank of an account from its total XP and its newest runs. */
export const dangerOf = (
  xp: number,
  runs: readonly RecentRunRow[]
): AccountDanger =>
  accountDanger(
    levelForXp(xp),
    runs.map((r) => r.deepestRoom)
  );

/**
 * Danger level and rank per player (D-194) for lists (guild members, leaderboards, lobbies): one
 * query for all of them.
 */
export async function accountDangers(
  db: DbOrTx,
  players: readonly { id: string; xp: number }[]
): Promise<Map<string, AccountDanger>> {
  const runs = await recentRuns(
    db,
    players.map((p) => p.id)
  );
  return new Map(
    players.map((p) => [p.id, dangerOf(p.xp, runs.get(p.id) ?? [])])
  );
}
