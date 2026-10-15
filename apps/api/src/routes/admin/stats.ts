import { AdminDailyStatsQuery } from "@soulwick/contracts";
import { Hono } from "hono";
import { parseQuery } from "../../lib/validate.ts";
import { dailyStats, overviewStats } from "../../services/admin-stats.ts";
import type { AppEnv, Deps } from "../../types.ts";

/** Overview figures and daily series (moderator and admin; numbers only, P-023). */
export function adminStatsRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();

  app.get("/", async (c) => c.json(await overviewStats(deps.db, now())));

  app.get("/daily", async (c) => {
    const { days } = parseQuery(c, AdminDailyStatsQuery);
    return c.json(await dailyStats(deps.db, days, now()));
  });

  return app;
}
