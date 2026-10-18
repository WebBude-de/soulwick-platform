import { API_VERSION, type HealthResponse } from "@soulwick/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createAuth } from "./auth/auth.ts";
import { createErrorHandler } from "./lib/errors.ts";
import { createLogger, requestLogger } from "./lib/logger.ts";
import { rateLimit } from "./lib/rate-limit.ts";
import { accountDeletionRoutes } from "./routes/account-deletion.ts";
import { adminRoutes } from "./routes/admin/index.ts";
import { authRoutes } from "./routes/auth.ts";
import { bugReportRoutes } from "./routes/bug-reports.ts";
import { guildRoutes } from "./routes/guilds.ts";
import {
  hasValidRelayKey,
  internalRelayRoutes,
} from "./routes/internal/relay.ts";
import { leaderboardRoutes } from "./routes/leaderboards.ts";
import { legalRoutes } from "./routes/legal.ts";
import { meRoutes } from "./routes/me.ts";
import { publicRoutes } from "./routes/public.ts";
import { runRoutes } from "./routes/runs.ts";
import { playerLoginCallbacks } from "./services/sessions.ts";
import type { AppEnv, BaseDeps, Deps } from "./types.ts";

/**
 * Builds the app and its Better Auth instance (P-027). Better Auth's own handler is not mounted:
 * every auth path is an explicit route (`/auth/*`, `/admin/auth/*`) that calls `auth.api`.
 */
export function createApp(base: BaseDeps) {
  const deps: Deps = {
    ...base,
    auth: createAuth(base, playerLoginCallbacks(base)),
  };
  const { config } = deps;
  const logger = createLogger(config.LOG_LEVEL);
  const app = new Hono<AppEnv>();

  app.onError(createErrorHandler(logger));
  app.notFound((c) =>
    c.json({ error: "not_found", message: "Route not found" }, 404)
  );

  app.use("*", requestLogger(logger, config.TRUST_PROXY));
  app.use("*", secureHeaders());
  // The game client and the server-rendered web/admin apps do not need CORS; only browser
  // origins listed in CORS_ORIGINS may call the API directly.
  app.use(
    "*",
    cors({
      origin: (origin) =>
        config.CORS_ORIGINS.includes(origin) ? origin : null,
      // If-Match / If-None-Match / ETag: revisions of cloud worlds (P-038, browser build).
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "If-Match",
        "If-None-Match",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["ETag", "Retry-After"],
      maxAge: 600,
    })
  );
  app.use(
    "*",
    rateLimit({
      limit: config.RATE_LIMIT_PER_MINUTE,
      trustProxy: config.TRUST_PROXY,
      // The relay asks for every player from one IP; its keyed calls are not limited per IP.
      skip: (c) =>
        c.req.path.startsWith("/internal/") &&
        hasValidRelayKey(c, config.RELAY_INTERNAL_KEY),
    })
  );

  app.get("/health", async (c) => {
    let db: HealthResponse["db"] = "ok";
    try {
      await deps.db.$queryRaw`select 1`;
    } catch {
      db = "error";
    }
    const body: HealthResponse = {
      status: db === "ok" ? "ok" : "degraded",
      apiVersion: API_VERSION,
      db,
      time: new Date().toISOString(),
      minGameVersion: config.MIN_GAME_VERSION || null,
      protocolVersion: config.PROTOCOL_VERSION,
    };
    return c.json(body, db === "ok" ? 200 : 503);
  });

  app.route("/auth", authRoutes(deps));
  app.route("/me", meRoutes(deps));
  app.route("/guilds", guildRoutes(deps));
  app.route("/runs", runRoutes(deps));
  app.route("/bug-reports", bugReportRoutes(deps));
  app.route("/leaderboards", leaderboardRoutes(deps));
  app.route("/public", publicRoutes(deps));
  app.route("/legal", legalRoutes(deps));
  app.route("/account-deletion", accountDeletionRoutes(deps));
  app.route("/admin", adminRoutes(deps));
  app.route("/internal/relay", internalRelayRoutes(deps));

  return app;
}

export type App = ReturnType<typeof createApp>;
