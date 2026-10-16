import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  GuildDetail,
  GuildRoomList,
  RELAY_KEY_HEADER,
  type RelayRoomSummary,
} from "@soulwick/contracts";
import { createTestContext, type TestContext } from "./helpers.ts";

const RELAY_URL = "http://relay.internal:8790";
const RELAY_KEY = "test-relay-internal-key-0123456789abcdef";
const NOW = new Date("2026-10-16T12:00:00.000Z");

type Handler = (
  url: URL,
  headers: Headers,
  signal: AbortSignal | undefined
) => Promise<Response> | Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Stand-in for the relay's internal endpoints; tests swap `handler`. */
function fakeRelay() {
  const state: { calls: number; handler: Handler } = {
    calls: 0,
    handler: () => json({ error: "unexpected" }, 599),
  };
  const fetchLike = async (input: string | URL, init?: RequestInit) => {
    state.calls += 1;
    return await state.handler(
      new URL(String(input)),
      new Headers(init?.headers),
      init?.signal ?? undefined
    );
  };
  return { state, fetch: fetchLike as unknown as typeof fetch };
}

/** Never answers; rejects when the API's timeout aborts the request. */
const hang: Handler = (_url, _headers, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

interface RoomOpts {
  code: string;
  guildId: string | null;
  /** Player ids, host first. */
  players: string[];
  started?: boolean;
}

function room(opts: RoomOpts): RelayRoomSummary {
  const started = opts.started ?? false;
  return {
    code: opts.code,
    mode: opts.guildId ? "guild" : "quick",
    guildId: opts.guildId,
    started,
    gameVersion: "1.0.0",
    playerCount: opts.players.length,
    maxPlayers: 4,
    players: opts.players.map((playerId, i) => ({
      peerId: i + 1,
      playerId,
      // The relay knows no name when the API was not reachable at `hello`.
      name: i === 0 ? null : "Relayname",
      platform: "windows",
      host: i === 0,
      inRoomSeconds: 10,
    })),
    createdAt: "2026-10-16T11:58:00.000Z",
    ageSeconds: 120,
    expiresAt: started ? null : "2026-10-16T12:28:00.000Z",
    runsStarted: started ? 1 : 0,
    bytesInPerSecond: 0,
    bytesOutPerSecond: 0,
  };
}

const roomList = (rooms: RelayRoomSummary[]) => ({
  time: NOW.toISOString(),
  protocolVersion: 1,
  rooms,
});

describe("GET /guilds/:id/rooms (relay configured)", () => {
  let ctx: TestContext;
  const relay = fakeRelay();
  beforeAll(async () => {
    ctx = await createTestContext(
      {
        RELAY_INTERNAL_URL: RELAY_URL,
        RELAY_INTERNAL_KEY: RELAY_KEY,
        RELAY_INTERNAL_TIMEOUT_MS: "200",
      },
      { fetch: relay.fetch, now: () => NOW }
    );
  });
  afterAll(() => ctx.close());

  async function guildOf(founderToken: string, tag: string) {
    const res = await ctx.req("POST", "/guilds", {
      token: founderToken,
      body: { name: `Raumgilde ${tag}`, tag },
    });
    expect(res.status).toBe(201);
    return GuildDetail.parse(res.json);
  }

  it("lists the guild's rooms with a free slot for a member", async () => {
    const founder = await ctx.login("Lumen");
    const member = await ctx.login("Wick");
    const guild = await guildOf(founder.token, "ROOM");
    const join = await ctx.req("POST", "/guilds/join", {
      token: member.token,
      body: { inviteCode: guild.inviteCode },
    });
    expect(join.status).toBe(200);
    const other = await guildOf((await ctx.login()).token, "ANDR");
    const full = [founder.id, member.id, randomUUID(), randomUUID()];

    const seen: { key: string | null } = { key: null };
    relay.state.handler = (url, headers) => {
      expect(url.pathname).toBe("/internal/rooms");
      seen.key = headers.get(RELAY_KEY_HEADER);
      return json(
        roomList([
          room({ code: "WATT23", guildId: guild.id, players: [founder.id] }),
          room({
            code: "RUNS34",
            guildId: guild.id,
            players: [member.id, founder.id],
            started: true,
          }),
          room({ code: "FUZZ56", guildId: guild.id, players: full }),
          room({ code: "QCKK77", guildId: null, players: [founder.id] }),
          room({ code: "THER89", guildId: other.id, players: [member.id] }),
        ])
      );
    };

    const res = await ctx.req("GET", `/guilds/${guild.id}/rooms`, {
      token: member.token,
    });
    expect(res.status).toBe(200);
    expect(seen.key).toBe(RELAY_KEY);
    const body = GuildRoomList.parse(res.json);
    expect(body.relayAvailable).toBe(true);
    expect(body.time).toBe(NOW.toISOString());
    expect(body.rooms.map((r) => r.code)).toEqual(["WATT23", "RUNS34"]);
    expect(body.rooms[0]).toEqual({
      code: "WATT23",
      // From the database although the relay had no name.
      hostName: "Lumen",
      hostPlayerId: founder.id,
      playerCount: 1,
      maxPlayers: 4,
      started: false,
      gameVersion: "1.0.0",
      players: [{ playerId: founder.id, name: "Lumen", host: true }],
      createdAt: "2026-10-16T11:58:00.000Z",
      expiresAt: "2026-10-16T12:28:00.000Z",
    });
    expect(body.rooms[1]).toMatchObject({
      started: true,
      expiresAt: null,
      hostName: "Wick",
      players: [
        { playerId: member.id, host: true },
        { playerId: founder.id, name: "Lumen", host: false },
      ],
    });
  });

  it("answers 403 not_member for non-members and unknown guilds, 404 for a bad id", async () => {
    const founder = await ctx.login();
    const outsider = await ctx.login();
    const guild = await guildOf(founder.token, "PRIV");
    const callsBefore = relay.state.calls;

    const res = await ctx.req("GET", `/guilds/${guild.id}/rooms`, {
      token: outsider.token,
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("not_member");

    const unknown = await ctx.req("GET", `/guilds/${randomUUID()}/rooms`, {
      token: outsider.token,
    });
    expect(unknown.status).toBe(403);
    expect(unknown.json.error).toBe("not_member");

    const bad = await ctx.req("GET", "/guilds/not-a-uuid/rooms", {
      token: outsider.token,
    });
    expect(bad.status).toBe(404);
    expect(bad.json.error).toBe("not_found");

    // The relay is not asked for callers who may not see the rooms.
    expect(relay.state.calls).toBe(callsBefore);
  });

  it("needs a player token", async () => {
    const res = await ctx.req("GET", `/guilds/${randomUUID()}/rooms`);
    expect(res.status).toBe(401);
  });

  it("answers an empty list with relayAvailable false when the relay fails", async () => {
    const founder = await ctx.login();
    const guild = await guildOf(founder.token, "DOWN");
    const path = `/guilds/${guild.id}/rooms`;

    for (const handler of [
      // unreachable
      () => Promise.reject(new TypeError("fetch failed")),
      // timeout
      hang,
      // wrong key / endpoints disabled
      () => json({ error: "unauthorized" }, 401),
      // unexpected answer
      () => json({ rooms: "nope" }),
    ] satisfies Handler[]) {
      relay.state.handler = handler;
      const res = await ctx.req("GET", path, { token: founder.token });
      expect(res.status).toBe(200);
      expect(GuildRoomList.parse(res.json)).toEqual({
        time: NOW.toISOString(),
        relayAvailable: false,
        rooms: [],
      });
    }
  });
});

describe("GET /guilds/:id/rooms (relay not configured)", () => {
  let ctx: TestContext;
  const relay = fakeRelay();
  beforeAll(async () => {
    ctx = await createTestContext({}, { fetch: relay.fetch });
  });
  afterAll(() => ctx.close());

  it("answers an empty list with relayAvailable false without asking anyone", async () => {
    const founder = await ctx.login();
    const created = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Ohne Relay", tag: "NORL" },
    });
    expect(created.status).toBe(201);
    const res = await ctx.req("GET", `/guilds/${created.json.id}/rooms`, {
      token: founder.token,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ relayAvailable: false, rooms: [] });
    expect(relay.state.calls).toBe(0);
  });
});
