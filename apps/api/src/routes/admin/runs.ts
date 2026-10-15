import { AdminRunsQuery, FlagRunRequest, Uuid } from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { Hono } from "hono";
import { notFound } from "../../lib/errors.ts";
import { parseBody, parseParam, parseQuery } from "../../lib/validate.ts";
import { requireRole } from "../../middleware/auth.ts";
import { listAdminRuns } from "../../services/admin-runs.ts";
import { writeAudit } from "../../services/audit.ts";
import type { AppEnv, Deps } from "../../types.ts";

export function adminRunRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  async function loadRun(id: string) {
    const run = await deps.db.run.findUnique({ where: { id } });
    if (!run) {
      throw notFound("Run");
    }
    return run;
  }

  app.get("/", async (c) => {
    const q = parseQuery(c, AdminRunsQuery);
    const where: Prisma.RunWhereInput = {
      ...(q.flagged ? { flagged: q.flagged === "true" } : {}),
      ...(q.guildId ? { guildId: q.guildId } : {}),
      ...(q.playerId
        ? { participants: { some: { playerId: q.playerId } } }
        : {}),
    };
    return c.json(await listAdminRuns(deps.db, where, q.limit, q.offset));
  });

  app.post("/:id/flag", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const { reason } = await parseBody(c, FlagRunRequest);
    const run = await loadRun(id);
    const admin = c.get("admin");
    await deps.db.$transaction(async (tx) => {
      await tx.run.update({
        where: { id },
        data: { flagged: true, flagReason: reason },
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "run.flag",
        targetType: "run",
        targetId: id,
        details: { reason, previousReason: run.flagReason },
      });
    });
    return c.json({ id, flagged: true, flagReason: reason });
  });

  /** Releases a run back to the leaderboards. */
  app.post("/:id/unflag", requireRole("moderator"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const run = await loadRun(id);
    const admin = c.get("admin");
    await deps.db.$transaction(async (tx) => {
      await tx.run.update({
        where: { id },
        data: { flagged: false, flagReason: null },
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "run.unflag",
        targetType: "run",
        targetId: id,
        details: { previousReason: run.flagReason },
      });
    });
    return c.json({ id, flagged: false, flagReason: null });
  });

  /** Admin only. */
  app.delete("/:id", requireRole("admin"), async (c) => {
    const id = parseParam(c, "id", Uuid);
    const run = await loadRun(id);
    const admin = c.get("admin");
    await deps.db.$transaction(async (tx) => {
      await tx.run.delete({ where: { id } });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "run.delete",
        targetType: "run",
        targetId: id,
        details: {
          mode: run.mode,
          guildId: run.guildId,
          roomReached: run.roomReached,
          durationSeconds: run.durationSeconds,
          flagReason: run.flagReason,
        },
      });
    });
    return c.body(null, 204);
  });

  return app;
}
