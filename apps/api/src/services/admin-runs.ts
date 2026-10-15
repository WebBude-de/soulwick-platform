import type { AdminRun } from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { iso } from "../lib/validate.ts";
import type { DbOrTx } from "./db-types.ts";

/** Runs with guild tag and participant names, newest first. */
export async function listAdminRuns(
  db: DbOrTx,
  where: Prisma.RunWhereInput,
  limit: number,
  offset: number
): Promise<{ items: AdminRun[]; total: number }> {
  const rows = await db.run.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    include: {
      guild: { select: { tag: true } },
      participants: {
        include: { player: { select: { id: true, name: true } } },
      },
    },
  });
  const total = await db.run.count({ where });

  const items = rows.map((run) => ({
    id: run.id,
    mode: run.mode,
    guildId: run.guildId,
    guildTag: run.guild?.tag ?? null,
    roomReached: run.roomReached,
    durationSeconds: run.durationSeconds,
    seed: run.seed,
    gameVersion: run.gameVersion,
    createdAt: iso(run.createdAt),
    flagged: run.flagged,
    flagReason: run.flagReason,
    participants: run.participants.map((p) => ({
      id: p.player.id,
      name: p.player.name,
    })),
  }));
  return { items, total };
}
