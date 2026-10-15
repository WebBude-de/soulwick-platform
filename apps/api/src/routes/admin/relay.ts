import {
  AdminRelayCloseRoomRequest,
  AdminRelayKickRequest,
  type AdminRelayRoomList,
  RoomCode,
} from "@soulwick/contracts";
import { type Context, Hono } from "hono";
import { ApiError } from "../../lib/errors.ts";
import { createRelayClient } from "../../lib/relay-client.ts";
import { parseBody } from "../../lib/validate.ts";
import { requireRole } from "../../middleware/auth.ts";
import { writeAudit } from "../../services/audit.ts";
import { guildLabels } from "../../services/guilds.ts";
import type { AppEnv, Deps } from "../../types.ts";

function roomCodeParam(c: Context<AppEnv>): string {
  const code = RoomCode.safeParse(c.req.param("code"));
  if (!code.success) {
    throw new ApiError(404, "room_not_found", "No open room with this code");
  }
  return code.data;
}

/**
 * Live rooms on the relay (P-024): read for moderators and admins, close and kick with a reason.
 * The relay holds the rooms in memory; the API only passes the calls through and writes the
 * audit log after the relay confirmed the action.
 */
export function adminRelayRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const relay = createRelayClient(deps.config, deps.fetch);

  /** Guild rooms get tag and name of their guild (D-147). */
  app.get("/rooms", async (c) => {
    const list = await relay.listRooms();
    const labels = await guildLabels(
      deps.db,
      list.rooms.flatMap((r) => (r.guildId ? [r.guildId] : []))
    );
    const body: AdminRelayRoomList = {
      ...list,
      rooms: list.rooms.map((r) => {
        const label = r.guildId ? labels.get(r.guildId) : undefined;
        return {
          ...r,
          guildTag: label?.tag ?? null,
          guildName: label?.name ?? null,
        };
      }),
    };
    return c.json(body);
  });

  app.post("/rooms/:code/close", requireRole("moderator"), async (c) => {
    const code = roomCodeParam(c);
    const { reason } = await parseBody(c, AdminRelayCloseRoomRequest);
    const result = await relay.closeRoom(code, reason);
    await writeAudit(deps.db, {
      adminId: c.get("admin").id,
      action: "relay.room_close",
      targetType: "relay_room",
      targetId: result.code,
      details: {
        reason,
        playerIds: result.playerIds,
        started: result.started,
      },
    });
    return c.json(result);
  });

  app.post("/rooms/:code/kick", requireRole("moderator"), async (c) => {
    const code = roomCodeParam(c);
    const { playerId, reason } = await parseBody(c, AdminRelayKickRequest);
    const result = await relay.kick(code, playerId, reason);
    await writeAudit(deps.db, {
      adminId: c.get("admin").id,
      action: "relay.kick",
      targetType: "player",
      targetId: playerId,
      details: {
        roomCode: result.code,
        reason,
        peerId: result.peerId,
        roomClosed: result.roomClosed,
      },
    });
    return c.json(result);
  });

  return app;
}
