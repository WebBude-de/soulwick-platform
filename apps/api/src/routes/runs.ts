import { CreateRunRequest } from "@soulwick/contracts";
import { Hono } from "hono";
import { parseBody } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import { reportRun } from "../services/runs.ts";
import type { AppEnv, Deps } from "../types.ts";

export function runRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requirePlayer(deps));

  /** The host reports a finished run; guild runs also pay into the guild treasury (D-081). */
  app.post("/", async (c) => {
    const body = await parseBody(c, CreateRunRequest);
    const result = await reportRun(deps.db, {
      body,
      config: deps.config,
      reporterId: c.get("player").id,
      createdAt: deps.now?.(),
    });
    // 200 = this reportId was reported before (stored result, no second payout, P-032).
    return c.json(result.body, result.status);
  });

  return app;
}
