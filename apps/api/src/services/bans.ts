import { type Ban, Prisma } from "@soulwick/db";
import type { DbOrTx } from "./db-types.ts";

/** Prisma filter for "ban is currently active" on the `bans` table. */
export function activeBanWhere(now: Date): Prisma.BanWhereInput {
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/** Raw-SQL variant for hand-written queries; `alias` is the bans table alias. */
export function activeBanSql(alias: string, now: Date): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`${a}.revoked_at is null and (${a}.expires_at is null or ${a}.expires_at > ${now.toISOString()}::timestamptz)`;
}

/** Same rule as activeBanWhere, for rows that are already loaded. */
export function isBanActive(
  ban: Pick<Ban, "expiresAt" | "revokedAt">,
  now: Date
): boolean {
  return (
    ban.revokedAt === null &&
    (ban.expiresAt === null || ban.expiresAt.getTime() > now.getTime())
  );
}

export function findActiveBan(
  db: DbOrTx,
  playerId: string,
  now: Date
): Promise<Ban | null> {
  return db.ban.findFirst({
    where: { playerId, ...activeBanWhere(now) },
    // A permanent ban wins over temporary ones, then the longest-running one.
    orderBy: [
      { expiresAt: { sort: "desc", nulls: "first" } },
      { createdAt: "desc" },
    ],
  });
}
