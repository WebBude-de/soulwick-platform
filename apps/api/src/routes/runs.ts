import { CreateRunRequest, type CreateRunResponse } from "@soulwick/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors.ts";
import { iso, parseBody } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import { checkPlausibility } from "../services/plausibility.ts";
import type { AppEnv, Deps } from "../types.ts";

export function runRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requirePlayer(deps));

  /** The host reports a finished run. */
  app.post("/", async (c) => {
    const reporter = c.get("player");
    const body = await parseBody(c, CreateRunRequest);

    if (!body.participants.includes(reporter.id)) {
      throw new ApiError(
        422,
        "reporter_not_participant",
        "The reporting player must be a participant"
      );
    }
    const known = await deps.db.player.findMany({
      where: { id: { in: body.participants } },
      select: { id: true },
    });
    if (known.length !== body.participants.length) {
      const knownIds = new Set(known.map((p) => p.id));
      throw new ApiError(
        422,
        "unknown_participants",
        "Some participants do not exist",
        {
          details: body.participants.filter((id) => !knownIds.has(id)),
        }
      );
    }

    const reasons: string[] = [];
    const plausibility = checkPlausibility(body, deps.config);
    if (plausibility) {
      reasons.push(plausibility);
    }

    if (body.mode === "guild" && body.guildId) {
      const members = await deps.db.guildMember.findMany({
        where: { guildId: body.guildId, playerId: { in: body.participants } },
        select: { playerId: true },
      });
      const memberIds = new Set(members.map((m) => m.playerId));
      if (!memberIds.has(reporter.id)) {
        throw new ApiError(
          403,
          "not_guild_member",
          "Only members can report guild runs"
        );
      }
      // D-080: only members may take part in a guild run.
      if (memberIds.size !== body.participants.length) {
        reasons.push("participant_not_in_guild");
      }
    }

    const flagReason = reasons.length > 0 ? reasons.join(",") : null;
    // Run and participants in one statement (nested create), so no explicit transaction is needed.
    const created = await deps.db.run.create({
      data: {
        mode: body.mode,
        guildId: body.guildId ?? null,
        reportedBy: reporter.id,
        roomReached: body.roomReached,
        durationSeconds: body.durationSeconds,
        seed: body.seed,
        gameVersion: body.gameVersion,
        flagged: flagReason !== null,
        flagReason,
        ...(deps.now ? { createdAt: deps.now() } : {}),
        participants: {
          create: body.participants.map((playerId) => ({ playerId })),
        },
      },
    });

    const response: CreateRunResponse = {
      id: created.id,
      flagged: created.flagged,
      flagReason: created.flagReason,
      createdAt: iso(created.createdAt),
    };
    return c.json(response, 201);
  });

  return app;
}
