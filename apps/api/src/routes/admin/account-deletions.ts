import {
  type AccountDeletionChannelCounts,
  type AdminAccountDeletionList,
  AdminAccountDeletionQuery,
} from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { Hono } from "hono";
import { hmacSecret } from "../../lib/secrets.ts";
import { timeRangeFilter } from "../../lib/time-range.ts";
import { iso, parseQuery } from "../../lib/validate.ts";
import { deletionLogHash } from "../../services/account-deletion.ts";
import type { AppEnv, Deps } from "../../types.ts";

/**
 * Deletion log (P-026): read only, for moderators and admins. Accounts are deleted automatically
 * (website code, in game) or by an admin (DELETE /admin/players/:id); nobody decides here.
 */
export function adminAccountDeletionRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const q = parseQuery(c, AdminAccountDeletionQuery);
    const deletedAt = timeRangeFilter(q.from, q.to);
    // Counts per channel ignore the channel filter, so the panel can show all three at once.
    const base: Prisma.AccountDeletionWhereInput = {
      ...(deletedAt ? { deletedAt } : {}),
      ...(q.playerId
        ? { playerHash: deletionLogHash(q.playerId, hmacSecret(deps.config)) }
        : {}),
    };
    const where: Prisma.AccountDeletionWhereInput = {
      ...base,
      ...(q.channel ? { channel: q.channel } : {}),
    };
    const [rows, total, grouped] = await Promise.all([
      deps.db.accountDeletion.findMany({
        where,
        orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
        take: q.limit,
        skip: q.offset,
      }),
      deps.db.accountDeletion.count({ where }),
      deps.db.accountDeletion.groupBy({
        by: ["channel"],
        where: base,
        _count: true,
      }),
    ]);
    const counts: AccountDeletionChannelCounts = {
      web_code: 0,
      in_game: 0,
      admin: 0,
    };
    for (const row of grouped) {
      counts[row.channel] = row._count;
    }
    const body: AdminAccountDeletionList = {
      items: rows.map((r) => ({
        id: r.id,
        deletedAt: iso(r.deletedAt),
        channel: r.channel,
        wasBanned: r.wasBanned,
      })),
      total,
      counts,
    };
    return c.json(body);
  });

  return app;
}
