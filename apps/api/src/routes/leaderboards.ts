import { LeaderboardKind, LeaderboardQuery } from "@soulwick/contracts";
import { Hono } from "hono";
import { ApiError } from "../lib/errors.ts";
import { parseQuery } from "../lib/validate.ts";
import { optionalPlayer } from "../middleware/auth.ts";
import { getLeaderboard } from "../services/leaderboard.ts";
import type { AppEnv, Deps } from "../types.ts";

export function leaderboardRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  /** Public. With a valid player token the response also contains the caller's own entry. */
  app.get("/:kind", optionalPlayer(deps), async (c) => {
    const kind = LeaderboardKind.safeParse(c.req.param("kind"));
    if (!kind.success) {
      throw new ApiError(
        404,
        "unknown_leaderboard",
        "Use solo, group or guild"
      );
    }
    const q = parseQuery(c, LeaderboardQuery);
    const board = await getLeaderboard(deps.db, {
      kind: kind.data,
      period: q.period,
      season: q.season ?? null,
      limit: q.limit,
      ownPlayerId: c.get("maybePlayer")?.id ?? null,
      now: deps.now?.() ?? new Date(),
    });
    c.header(
      "Cache-Control",
      c.get("maybePlayer") ? "private, no-store" : "public, max-age=30"
    );
    return c.json(board);
  });

  return app;
}
