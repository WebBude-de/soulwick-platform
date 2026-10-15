import type { AdminRole } from "@soulwick/contracts";
import type { MiddlewareHandler } from "hono";
import { PLAYER_ROLE } from "../auth/player-plugin.ts";
import { ApiError } from "../lib/errors.ts";
import { isoOrNull } from "../lib/validate.ts";
import { adminFromAuthorization } from "../services/admin-users.ts";
import { findActiveBan } from "../services/bans.ts";
import { sessionFromAuthorization } from "../services/sessions.ts";
import type { AppEnv, Deps } from "../types.ts";

const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

/**
 * The player behind a Better Auth session token (P-027), or null. Only sessions of player users
 * (role `player` with a player id) count; admin sessions never pass as players.
 */
async function loadPlayerFromRequest(
  deps: Deps,
  authorization: string | undefined
) {
  const session = await sessionFromAuthorization(deps, authorization);
  const playerId = session?.user.playerId;
  if (!(session && playerId) || session.user.role !== PLAYER_ROLE) {
    return null;
  }
  return await deps.db.player.findUnique({ where: { id: playerId } });
}

/**
 * Requires a valid player session token. Banned players get 403
 * `{ error: "banned", reason, expiresAt }`. Also refreshes `last_seen_at` (at most every 5 minutes).
 */
export function requirePlayer(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const player = await loadPlayerFromRequest(
      deps,
      c.req.header("authorization")
    );
    if (!player) {
      throw new ApiError(401, "unauthorized", "Valid player token required");
    }

    const now = deps.now?.() ?? new Date();
    const ban = await findActiveBan(deps.db, player.id, now);
    if (ban) {
      return c.json(
        {
          error: "banned" as const,
          reason: ban.reason,
          expiresAt: isoOrNull(ban.expiresAt),
        },
        403
      );
    }

    if (now.getTime() - player.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await deps.db.player.updateMany({
        where: { id: player.id, lastSeenAt: { lt: now } },
        data: { lastSeenAt: now },
      });
    }
    c.set("player", player);
    await next();
  };
}

/** Sets `maybePlayer` if a valid, unbanned player token was sent; never rejects. */
export function optionalPlayer(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let player = await loadPlayerFromRequest(
      deps,
      c.req.header("authorization")
    );
    if (
      player &&
      (await findActiveBan(deps.db, player.id, deps.now?.() ?? new Date()))
    ) {
      player = null;
    }
    c.set("maybePlayer", player);
    await next();
  };
}

/**
 * Requires the session token of an enabled admin or moderator (P-027). Player sessions, disabled
 * accounts and ended sessions get 401 `unauthorized`.
 */
export function requireAdmin(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const admin = await adminFromAuthorization(
      deps,
      c.req.header("authorization")
    );
    if (!admin) {
      throw new ApiError(401, "unauthorized", "Valid admin token required");
    }
    c.set("admin", admin);
    await next();
  };
}

const ROLE_RANK: Record<AdminRole, number> = { moderator: 1, admin: 2 };

/** Use after requireAdmin. The role is read from the database on every call, not from a token. */
export function requireRole(role: AdminRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (ROLE_RANK[c.get("admin").role] < ROLE_RANK[role]) {
      throw new ApiError(403, "forbidden", `Requires role ${role}`);
    }
    await next();
  };
}
