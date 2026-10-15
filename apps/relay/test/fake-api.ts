import { randomUUID } from "node:crypto";
import {
  PLAYER_JWKS_PATH,
  RELAY_KEY_HEADER,
  type RelayPlayerStatus,
} from "@soulwick/contracts";
import { type Server, serve } from "bun";
import { API_KEY, type TestKey } from "./jwt.ts";

export const RELAY_KEY = "test-relay-internal-key-0123456789abcdef";
const PREFIX = "/internal/relay/players/";
const SUFFIX = "/status";

/**
 * Stand-in for the API's `GET /internal/relay/players/:id/status` on a random port, with the same
 * status codes as apps/api/src/routes/internal/relay.ts, and its public JWKS (`GET /auth/jwks`).
 */
export function startFakeApi() {
  const players = new Map<string, RelayPlayerStatus>();
  const state: {
    calls: number;
    delayMs: number;
    failWith: number;
    jwksCalls: number;
    keys: TestKey[];
  } = {
    calls: 0,
    delayMs: 0,
    failWith: 0,
    jwksCalls: 0,
    keys: [API_KEY],
  };
  const server: Server<undefined> = serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (new URL(req.url).pathname === PLAYER_JWKS_PATH) {
        state.jwksCalls += 1;
        return Response.json({ keys: state.keys.map((k) => k.publicJwk) });
      }
      state.calls += 1;
      if (state.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      }
      if (state.failWith) {
        return Response.json({ error: "boom" }, { status: state.failWith });
      }
      if (req.headers.get(RELAY_KEY_HEADER) !== RELAY_KEY) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const path = new URL(req.url).pathname;
      const id =
        path.startsWith(PREFIX) && path.endsWith(SUFFIX)
          ? path.slice(PREFIX.length, -SUFFIX.length)
          : "";
      const status = players.get(id);
      if (!status) {
        return Response.json({ error: "player_not_found" }, { status: 404 });
      }
      return Response.json(status);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    players,
    state,
    add(name: string, extra: Partial<RelayPlayerStatus> = {}) {
      const status: RelayPlayerStatus = {
        playerId: randomUUID(),
        name,
        banned: false,
        guildId: null,
        guildMember: null,
        ...extra,
      };
      players.set(status.playerId, status);
      return status;
    },
    stop: () => server.stop(true),
  };
}
