import type {
  AdminDailyStats,
  AdminDailyStatsDay,
  AdminStats,
  RoomReachedBucket,
  RunModeCounts,
} from "@soulwick/contracts";
import { Prisma } from "@soulwick/db";
import { activeBanSql } from "./bans.ts";
import type { DbOrTx } from "./db-types.ts";

const DAY_MS = 86_400_000;

/** TESTWERT: bucket edges of the "room reached" distribution; the last bucket is open. */
const ROOM_BUCKETS: readonly [number, number | null][] = [
  [0, 5],
  [6, 10],
  [11, 15],
  [16, 20],
  [21, 30],
  [31, 40],
  [41, 50],
  [51, null],
];

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const sqlTime = (d: Date) => Prisma.sql`${d.toISOString()}::timestamptz`;

/** "YYYY-MM-DD" of a UTC day. */
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

async function runsByMode(
  db: DbOrTx,
  where: Prisma.RunWhereInput
): Promise<RunModeCounts> {
  const rows = await db.run.groupBy({ by: ["mode"], where, _count: true });
  const counts: RunModeCounts = { solo: 0, quick: 0, guild: 0 };
  for (const row of rows) {
    counts[row.mode] = row._count;
  }
  return counts;
}

/** GET /admin/stats: totals plus the 24-hour and 7-day activity figures (P-023). */
export async function overviewStats(
  db: DbOrTx,
  now: Date
): Promise<AdminStats> {
  const week = ago(now, 7 * DAY_MS);
  const day = ago(now, DAY_MS);
  const [
    activeBans,
    players,
    guilds,
    flaggedRuns,
    deletions7d,
    newPlayers7d,
    activePlayers7d,
    runs24h,
    runs7d,
    runsTotal,
    modes,
    activeGuilds7d,
    newBugReports,
  ] = await Promise.all([
    db.$queryRaw<
      { n: number }[]
    >`select count(distinct b.player_id)::int as n from bans b where ${activeBanSql("b", now)}`,
    db.player.count(),
    db.guild.count({ where: { disbandedAt: null } }),
    db.run.count({ where: { flagged: true } }),
    db.accountDeletion.count({ where: { deletedAt: { gte: week } } }),
    db.player.count({ where: { createdAt: { gte: week } } }),
    db.player.count({ where: { lastSeenAt: { gte: week } } }),
    db.run.count({ where: { createdAt: { gte: day } } }),
    db.run.count({ where: { createdAt: { gte: week } } }),
    db.run.count(),
    runsByMode(db, {}),
    db.guild.count({
      where: {
        disbandedAt: null,
        members: { some: { player: { lastSeenAt: { gte: week } } } },
      },
    }),
    db.bugReport.count({ where: { status: "new" } }),
  ]);
  return {
    players,
    activeBans: activeBans[0]?.n ?? 0,
    guilds,
    flaggedRuns,
    // Deprecated since P-026 (no manual deletion requests any more); kept for older admin builds.
    openDeletionRequests: 0,
    newPlayers7d,
    activePlayers7d,
    runs24h,
    runs7d,
    runsTotal,
    runsByMode: modes,
    activeGuilds7d,
    deletions7d,
    newBugReports,
  };
}

/**
 * GET /admin/stats/daily: one entry per UTC day from `days - 1` days ago up to today, plus totals,
 * a "room reached" distribution and duration averages over the unflagged runs of the window.
 * Only aggregates; no player names or ids leave this function.
 */
export async function dailyStats(
  db: DbOrTx,
  days: number,
  now: Date
): Promise<AdminDailyStats> {
  const today = new Date(`${utcDay(now)}T00:00:00.000Z`);
  const from = ago(today, (days - 1) * DAY_MS);
  const since = sqlTime(from);
  const dayOf = (column: string) =>
    Prisma.raw(`to_char((${column} at time zone 'UTC')::date, 'YYYY-MM-DD')`);

  const [newPlayers, runs, active, totals, rooms, averages, modes] =
    await Promise.all([
      db.$queryRaw<{ day: string; n: number }[]>`
        select ${dayOf("created_at")} as day, count(*)::int as n
        from players where created_at >= ${since} group by 1`,
      db.$queryRaw<{ day: string; n: number; flagged: number }[]>`
        select ${dayOf("created_at")} as day, count(*)::int as n,
               count(*) filter (where flagged)::int as flagged
        from runs where created_at >= ${since} group by 1`,
      db.$queryRaw<{ day: string; n: number }[]>`
        select ${dayOf("r.created_at")} as day, count(distinct rp.player_id)::int as n
        from runs r join run_players rp on rp.run_id = r.id
        where r.created_at >= ${since} group by 1`,
      db.$queryRaw<{ n: number }[]>`
        select count(distinct rp.player_id)::int as n
        from runs r join run_players rp on rp.run_id = r.id
        where r.created_at >= ${since}`,
      db.$queryRaw<{ room: number; n: number }[]>`
        select room_reached as room, count(*)::int as n
        from runs where created_at >= ${since} and not flagged group by 1`,
      db.$queryRaw<
        {
          avg_room: number | null;
          avg_duration: number | null;
          median_duration: number | null;
        }[]
      >`
        select avg(room_reached)::float8 as avg_room,
               avg(duration_seconds)::float8 as avg_duration,
               percentile_cont(0.5) within group (order by duration_seconds)::float8 as median_duration
        from runs where created_at >= ${since} and not flagged`,
      runsByMode(db, { createdAt: { gte: from } }),
    ]);

  const byDay = <T extends { day: string }>(rows: T[]) =>
    new Map(rows.map((r) => [r.day, r]));
  const newByDay = byDay(newPlayers);
  const runsByDay = byDay(runs);
  const activeByDay = byDay(active);

  const series: AdminDailyStatsDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = utcDay(new Date(from.getTime() + i * DAY_MS));
    series.push({
      date,
      newPlayers: newByDay.get(date)?.n ?? 0,
      runs: runsByDay.get(date)?.n ?? 0,
      activePlayers: activeByDay.get(date)?.n ?? 0,
    });
  }

  const roomReached: RoomReachedBucket[] = ROOM_BUCKETS.map(([min, max]) => ({
    min,
    max,
    runs: rooms
      .filter((r) => r.room >= min && (max === null || r.room <= max))
      .reduce((sum, r) => sum + r.n, 0),
  }));
  const round1 = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Math.round(v * 10) / 10;
  const avg = averages[0];

  return {
    days,
    from: utcDay(from),
    to: utcDay(today),
    generatedAt: now.toISOString(),
    series,
    totals: {
      newPlayers: series.reduce((sum, d) => sum + d.newPlayers, 0),
      runs: series.reduce((sum, d) => sum + d.runs, 0),
      flaggedRuns: runs.reduce((sum, r) => sum + r.flagged, 0),
      activePlayers: totals[0]?.n ?? 0,
      runsByMode: modes,
    },
    roomReached,
    averageRoomReached: round1(avg?.avg_room),
    averageDurationSeconds: round1(avg?.avg_duration),
    medianDurationSeconds: round1(avg?.median_duration),
  };
}
