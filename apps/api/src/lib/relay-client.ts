import {
  RELAY_INTERNAL_PATHS,
  RELAY_KEY_HEADER,
  RelayBanPlayerResponse,
  RelayCloseRoomResponse,
  RelayKickResponse,
  RelayRoomList,
} from "@soulwick/contracts";
import type { z } from "zod";
import type { Config } from "../config.ts";
import { ApiError, withCause } from "./errors.ts";

/** Error codes of the relay that are passed on to the admin panel unchanged (all 404). */
const PASSED_ON = new Set(["room_not_found", "player_not_in_room"]);

const unavailable = (message: string, cause?: unknown) =>
  withCause(new ApiError(502, "relay_unavailable", message), cause);

/**
 * Client for the relay's internal endpoints (RELAY_INTERNAL_PATHS in @soulwick/contracts, P-024)
 * over the injectable `fetch`. Every failure becomes an ApiError: 501 `relay_not_configured`,
 * 502 `relay_unavailable` (unreachable, timeout, wrong key, endpoints disabled at the relay,
 * unexpected answer), 404 `room_not_found` / `player_not_in_room` as the relay reports them.
 */
export function createRelayClient(
  config: Pick<
    Config,
    "RELAY_INTERNAL_URL" | "RELAY_INTERNAL_KEY" | "RELAY_INTERNAL_TIMEOUT_MS"
  >,
  doFetch: typeof fetch = fetch
) {
  const configured =
    config.RELAY_INTERNAL_URL !== "" && config.RELAY_INTERNAL_KEY !== "";

  async function call<T extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: T,
    body?: unknown
  ): Promise<z.output<T>> {
    if (!configured) {
      throw new ApiError(
        501,
        "relay_not_configured",
        "RELAY_INTERNAL_URL / RELAY_INTERNAL_KEY are not set"
      );
    }
    let res: Response;
    try {
      res = await doFetch(`${config.RELAY_INTERNAL_URL}${path}`, {
        method,
        headers: {
          [RELAY_KEY_HEADER]: config.RELAY_INTERNAL_KEY,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(config.RELAY_INTERNAL_TIMEOUT_MS),
      });
    } catch (err) {
      throw unavailable("Relay not reachable", err);
    }
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : "";
      if (res.status === 404 && PASSED_ON.has(code)) {
        const message =
          code === "room_not_found"
            ? "No open room with this code"
            : "Player is not in this room";
        throw new ApiError(404, code, message);
      }
      throw unavailable(`Relay answered ${res.status} ${code}`.trim());
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw unavailable("Unexpected answer from the relay", parsed.error);
    }
    return parsed.data;
  }

  return {
    configured,
    listRooms: () => call("GET", RELAY_INTERNAL_PATHS.rooms, RelayRoomList),
    closeRoom: (code: string, reason: string) =>
      call(
        "POST",
        RELAY_INTERNAL_PATHS.closeRoom(code),
        RelayCloseRoomResponse,
        { reason }
      ),
    kick: (code: string, playerId: string, reason: string) =>
      call("POST", RELAY_INTERNAL_PATHS.kick(code), RelayKickResponse, {
        playerId,
        reason,
      }),
    banPlayer: (playerId: string) =>
      call(
        "POST",
        RELAY_INTERNAL_PATHS.banPlayer(playerId),
        RelayBanPlayerResponse,
        {}
      ),
  };
}

export type RelayClient = ReturnType<typeof createRelayClient>;
