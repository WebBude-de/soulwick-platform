import {
  type AddXpResponse,
  accountLevel,
  runXp,
  XP_FUTURE_TOLERANCE_SECONDS,
  XP_MAX_PER_DAY,
  type XpEntry,
  type XpEntryResult,
  xpDayOf,
} from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import type { Config } from "../config.ts";
import type { Db, Tx } from "./db-types.ts";
import { checkPlausibility } from "./plausibility.ts";

/**
 * Account XP (D-188, KF3; Konzept Konto und Fortschritt §5). The game uploads the counts of its
 * own runs; this service computes the XP with `runXp` from the contract, grants the account
 * record bonus and the first run of the day from the account's stored entries, applies the
 * plausibility check of run reports and the daily cap, and keeps `players.xp` (the sum of the
 * entries) in step. The level is always derived (`accountLevel`), never stored.
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
