import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardPeriod,
  LeaderboardResponse,
} from "@soulwick/contracts";
import { Prisma } from "@soulwick/db";
import { iso } from "../lib/validate.ts";
import { activeBanSql } from "./bans.ts";
import type { DbOrTx } from "./db-types.ts";

export function currentSeason(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function seasonRange(season: string): { start: Date; end: Date } {
  const [y, m] = season.split("-").map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

interface Row {
  created_at: Date | string;
  duration_seconds: number;
  entity_id: string;
  member_count: number | null;
  name: string;
  pos: number;
  rank: number;
  room_reached: number;
  run_id: string;
  tag: string | null;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Ranking (D-082): best run per player/guild - highest room, tie -> shorter duration (then the
 * earlier run). Flagged runs and runs with a currently banned participant are excluded; the guild
 * board also excludes disbanded guilds. Raw SQL: window functions and DISTINCT ON have no Prisma
 * query equivalent.
 */
export async function getLeaderboard(
  db: DbOrTx,
  opts: {
    kind: LeaderboardKind;
    period: LeaderboardPeriod;
    season: string | null;
    limit: number;
    ownPlayerId: string | null;
    now: Date;
  }
): Promise<LeaderboardResponse> {
  const { kind, period, limit, now } = opts;
  const season =
    period === "season" ? (opts.season ?? currentSeason(now)) : null;

  const filters: Prisma.Sql[] = [
    Prisma.sql`r.flagged = false`,
    Prisma.sql`not exists (
      select 1 from run_players bp join bans b on b.player_id = bp.player_id
      where bp.run_id = r.id and ${activeBanSql("b", now)}
    )`,
  ];
  if (season) {
    const { start, end } = seasonRange(season);
    filters.push(
      Prisma.sql`r.created_at >= ${start.toISOString()}::timestamptz`
    );
    filters.push(Prisma.sql`r.created_at < ${end.toISOString()}::timestamptz`);
  }
  const where = Prisma.join(filters, " and ");
  const order = Prisma.sql`b.room_reached desc, b.duration_seconds asc`;

  let query: Prisma.Sql;
  let ownEntityId: string | null = opts.ownPlayerId;

  if (kind === "guild") {
    if (opts.ownPlayerId) {
      const own = await db.guildMember.findUnique({
        where: { playerId: opts.ownPlayerId },
        select: { guildId: true },
      });
      ownEntityId = own?.guildId ?? null;
    }
    query = Prisma.sql`
      with eligible as (
        select r.id as run_id, r.guild_id as entity_id, r.room_reached, r.duration_seconds, r.created_at
        from runs r
        join guilds g on g.id = r.guild_id and g.disbanded_at is null
        where r.mode = 'guild' and ${where}
      ),
      best as (
        select distinct on (entity_id) * from eligible
        order by entity_id, room_reached desc, duration_seconds asc, created_at asc
      ),
      ranked as (
        select b.*, g.name, g.tag,
          (select count(*)::int from guild_members gm where gm.guild_id = b.entity_id) as member_count,
          rank() over (order by ${order})::int as rank,
          row_number() over (order by ${order}, b.created_at asc)::int as pos
        from best b join guilds g on g.id = b.entity_id
      )
      select * from ranked
      where pos <= ${limit} or entity_id = ${ownEntityId ?? NIL_UUID}::uuid
      order by pos`;
  } else {
    const modes =
      kind === "solo"
        ? Prisma.sql`r.mode = 'solo'`
        : Prisma.sql`r.mode in ('quick', 'guild')`;
    query = Prisma.sql`
      with eligible as (
        select r.id as run_id, rp.player_id as entity_id, r.room_reached, r.duration_seconds, r.created_at
        from runs r
        join run_players rp on rp.run_id = r.id
        where ${modes} and ${where}
      ),
      best as (
        select distinct on (entity_id) * from eligible
        order by entity_id, room_reached desc, duration_seconds asc, created_at asc
      ),
      ranked as (
        select b.*, p.name, g.tag, null::int as member_count,
          rank() over (order by ${order})::int as rank,
          row_number() over (order by ${order}, b.created_at asc)::int as pos
        from best b
        join players p on p.id = b.entity_id
        left join guild_members gm on gm.player_id = b.entity_id
        left join guilds g on g.id = gm.guild_id and g.disbanded_at is null
      )
      select * from ranked
      where pos <= ${limit} or entity_id = ${ownEntityId ?? NIL_UUID}::uuid
      order by pos`;
  }

  const rows = await db.$queryRaw<Row[]>(query);
  const toEntry = (r: Row): LeaderboardEntry => ({
    rank: Number(r.rank),
    id: r.entity_id,
    name: r.name,
    tag: r.tag,
    roomReached: Number(r.room_reached),
    durationSeconds: Number(r.duration_seconds),
    runId: r.run_id,
    achievedAt: iso(r.created_at),
    memberCount: r.member_count === null ? null : Number(r.member_count),
  });

  const entries = rows.filter((r) => Number(r.pos) <= limit).map(toEntry);
  const ownRow = ownEntityId
    ? rows.find((r) => r.entity_id === ownEntityId)
    : undefined;

  return {
    kind,
    period,
    season,
    entries,
    own: ownRow ? toEntry(ownRow) : null,
  };
}
