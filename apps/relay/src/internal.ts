import { timingSafeEqual } from "node:crypto";
import {
  RELAY_KEY_HEADER,
  RelayCloseRoomRequest,
  RelayKickRequest,
  type RelayRoomList,
  RoomCode,
  Uuid,
} from "@soulwick/contracts";
import type { z } from "zod";
import type { Config } from "./config.ts";
import type { Relay } from "./relay.ts";

const ROOMS_PATH = "/internal/rooms";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const error = (status: number, code: string, message: string) =>
  json({ error: code, message }, status);

/** Constant-time comparison of the `x-relay-key` header with RELAY_INTERNAL_KEY. */
export function hasRelayKey(req: Request, key: string): boolean {
  const sent = req.headers.get(RELAY_KEY_HEADER);
  if (!(key && sent)) {
    return false;
  }
  const a = Buffer.from(sent);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T
): Promise<Parsed<z.output<T>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: error(400, "invalid_json", "Request body must be valid JSON"),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: json(
        {
          error: "validation_error",
          message: "Invalid request body",
          details: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400
      ),
    };
  }
  return { ok: true, data: result.data };
}

async function roomAction(
  req: Request,
  relay: Relay,
  rawCode: string,
  action: "close" | "kick"
): Promise<Response> {
  const code = RoomCode.safeParse(rawCode);
  if (!code.success) {
    return error(404, "room_not_found", "No such room");
  }
  if (action === "close") {
    const body = await parseBody(req, RelayCloseRoomRequest);
    if (!body.ok) {
      return body.response;
    }
    const result = relay.adminCloseRoom(code.data, body.data.reason);
    return result ? json(result) : error(404, "room_not_found", "No such room");
  }
  const body = await parseBody(req, RelayKickRequest);
  if (!body.ok) {
    return body.response;
  }
  const result = relay.adminKick(
    code.data,
    body.data.playerId,
    body.data.reason
  );
  if (result === "room_not_found") {
    return error(404, "room_not_found", "No such room");
  }
  if (result === "player_not_in_room") {
    return error(404, "player_not_in_room", "Player is not in this room");
  }
  return json(result);
}

/**
 * Internal endpoints for the API (admin panel, bans), see RELAY_INTERNAL_PATHS in
 * @soulwick/contracts: 404 while RELAY_INTERNAL_KEY is empty, 401 without the right key. They
 * only use the relay's existing flows (`room_closed`, `peer_left`, `banned`).
 */
export async function handleInternal(
  req: Request,
  path: string,
  relay: Relay,
  config: Config,
  now: () => number
): Promise<Response> {
  if (!config.RELAY_INTERNAL_KEY) {
    return error(404, "not_found", "Route not found");
  }
  if (!hasRelayKey(req, config.RELAY_INTERNAL_KEY)) {
    return error(401, "unauthorized", "Valid relay key required");
  }

  if (path === ROOMS_PATH) {
    if (req.method !== "GET") {
      return error(405, "method_not_allowed", "Use GET");
    }
    const body: RelayRoomList = {
      time: new Date(now()).toISOString(),
      protocolVersion: config.PROTOCOL_VERSION,
      rooms: relay.listRooms(),
    };
    return json(body);
  }

  // /internal/rooms/:code/(close|kick) and /internal/players/:playerId/ban
  const [, , area, id = "", action, ...rest] = path.split("/");
  if (
    rest.length === 0 &&
    area === "rooms" &&
    (action === "close" || action === "kick")
  ) {
    if (req.method !== "POST") {
      return error(405, "method_not_allowed", "Use POST");
    }
    return await roomAction(req, relay, id, action);
  }
  if (rest.length === 0 && area === "players" && action === "ban") {
    if (req.method !== "POST") {
      return error(405, "method_not_allowed", "Use POST");
    }
    const playerId = Uuid.safeParse(id);
    if (!playerId.success) {
      return error(404, "not_found", "Invalid player id");
    }
    return json(relay.banPlayer(playerId.data));
  }

  return error(404, "not_found", "Route not found");
}
