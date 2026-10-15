import { timingSafeEqual } from "node:crypto";
import {
  RELAY_KEY_HEADER,
  RelayPlayerStatusQuery,
  Uuid,
} from "@soulwick/contracts";
import { type Context, Hono } from "hono";
import { ApiError } from "../../lib/errors.ts";
import { parseParam, parseQuery } from "../../lib/validate.ts";
import { getRelayPlayerStatus } from "../../services/relay-status.ts";
import type { AppEnv, Deps } from "../../types.ts";

/** Constant-time comparison of the `x-relay-key` header with RELAY_INTERNAL_KEY. */
export function hasValidRelayKey(c: Context, key: string): boolean {
  const sent = c.req.header(RELAY_KEY_HEADER);
  if (!(key && sent)) {
    return false;
  }
  const a = Buffer.from(sent);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Internal endpoints for the relay (apps/relay). Meant for the Docker network of one environment;
 * the shared key protects them in case the path is reachable from outside. Disabled (404) while
 * RELAY_INTERNAL_KEY is empty.
 */
export function internalRelayRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const key = deps.config.RELAY_INTERNAL_KEY;

  app.use("*", async (c, next) => {
    if (!key) {
      throw new ApiError(404, "not_found", "Route not found");
    }
    if (!hasValidRelayKey(c, key)) {
      throw new ApiError(401, "unauthorized", "Valid relay key required");
    }
    await next();
  });

  app.get("/players/:playerId/status", async (c) => {
    const playerId = parseParam(c, "playerId", Uuid);
    const { guildId } = parseQuery(c, RelayPlayerStatusQuery);
    const status = await getRelayPlayerStatus(
      deps.db,
      playerId,
      guildId,
      deps.now?.() ?? new Date()
    );
    if (!status) {
      throw new ApiError(404, "player_not_found", "Player not found");
    }
    return c.json(status);
  });

  return app;
}
