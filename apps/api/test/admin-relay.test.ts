import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AdminRelayRoomList,
  RELAY_KEY_HEADER,
  type RelayRoomList,
} from "@soulwick/contracts";
import { createTestContext, type TestContext, testConfig } from "./helpers.ts";

const RELAY_URL = "http://relay.internal:8790";
const RELAY_KEY = "test-relay-internal-key-0123456789abcdef";
const CODE = "ABC234";

interface Call {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: URL;
}

type Handler = (
  call: Call,
  signal: AbortSignal | undefined
) => Promise<Response> | Response;

/** Never answers; rejects when the API's timeout aborts the request. */
const hang: Handler = (_call, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Stand-in for the relay's internal endpoints: tests swap `handler` and inspect `calls`. */
function fakeRelay() {
  const state: { calls: Call[]; handler: Handler } = {
    calls: [],
    handler: () => json({ error: "unexpected" }, 599),
  };
  const fetchLike = async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    state.calls.push(call);
    return await state.handler(call, init?.signal ?? undefined);
  };
  return { state, fetch: fetchLike as unknown as typeof fetch };
}

const roomList = (playerId: string): RelayRoomList => ({
  time: new Date().toISOString(),
  protocolVersion: 1,
  rooms: [
    {
      code: CODE,
      mode: "quick",
      guildId: null,
      started: true,
      gameVersion: "1.0.0",
      playerCount: 1,
      maxPlayers: 4,
      players: [
        {
          peerId: 1,
          playerId,
          name: "Gastgeber",
          platform: "windows",
          host: true,
          inRoomSeconds: 42,
        },
      ],
      createdAt: new Date().toISOString(),
      ageSeconds: 42,
      expiresAt: null,
      runsStarted: 1,
      bytesInPerSecond: 1200,
      bytesOutPerSecond: 3400,
    },
  ],
});

describe("admin: live rooms on the relay", () => {
  let ctx: TestContext;
  const relay = fakeRelay();
  beforeAll(async () => {
    ctx = await createTestContext(
      {
        RELAY_INTERNAL_URL: `${RELAY_URL}/`,
        RELAY_INTERNAL_KEY: RELAY_KEY,
        RELAY_INTERNAL_TIMEOUT_MS: "200",
      },
      { fetch: relay.fetch }
    );
  });
  afterAll(() => ctx.close());

  const lastCall = () => relay.state.calls.at(-1);

  it("passes the room list through with the relay key (moderators may read)", async () => {
    const mod = await ctx.createAdmin("moderator");
    const playerId = randomUUID();
    relay.state.handler = () => json(roomList(playerId));
    const res = await ctx.req("GET", "/admin/relay/rooms", {
      token: mod.token,
    });
    expect(res.status).toBe(200);
    expect(AdminRelayRoomList.parse(res.json).rooms[0]).toMatchObject({
      code: CODE,
      players: [{ playerId, host: true }],
      bytesOutPerSecond: 3400,
    });
    expect(lastCall()?.url.toString()).toBe(`${RELAY_URL}/internal/rooms`);
    expect(lastCall()?.headers[RELAY_KEY_HEADER]).toBe(RELAY_KEY);

    const p = await ctx.login();
    expect(
      (await ctx.req("GET", "/admin/relay/rooms", { token: p.token })).status
    ).toBe(401);
  });

  it("closes a room with a reason and writes the audit log", async () => {
    const mod = await ctx.createAdmin("moderator");
    const playerIds = [randomUUID(), randomUUID()];
    relay.state.handler = () => json({ code: CODE, playerIds, started: false });
    const res = await ctx.req(
      "POST",
      `/admin/relay/rooms/${CODE.toLowerCase()}/close`,
      { token: mod.token, body: { reason: "Anstößiger Raumname" } }
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ code: CODE, playerIds, started: false });
    expect(lastCall()).toMatchObject({
      method: "POST",
      body: { reason: "Anstößiger Raumname" },
    });
    expect(lastCall()?.url.pathname).toBe(`/internal/rooms/${CODE}/close`);

    const audit = await ctx.req(
      "GET",
      `/admin/audit?action=relay.room_close&targetType=relay_room&targetId=${CODE}`,
      { token: mod.token }
    );
    expect(audit.json.items[0]).toMatchObject({
      adminId: mod.id,
      details: { reason: "Anstößiger Raumname", playerIds, started: false },
    });
  });

  it("kicks a player with a reason; the audit entry targets the player", async () => {
    const mod = await ctx.createAdmin("moderator");
    const playerId = randomUUID();
    relay.state.handler = () =>
      json({ code: CODE, playerId, peerId: 3, roomClosed: false });
    const res = await ctx.req("POST", `/admin/relay/rooms/${CODE}/kick`, {
      token: mod.token,
      body: { playerId, reason: "Belästigung im Chat" },
    });
    expect(res.status).toBe(200);
    expect(lastCall()?.body).toEqual({
      playerId,
      reason: "Belästigung im Chat",
    });
    const audit = await ctx.req(
      "GET",
      `/admin/audit?action=relay.kick&targetId=${playerId}`,
      { token: mod.token }
    );
    expect(audit.json.items[0]).toMatchObject({
      targetType: "player",
      details: {
        roomCode: CODE,
        reason: "Belästigung im Chat",
        peerId: 3,
        roomClosed: false,
      },
    });
  });

  it("validates before calling the relay and passes the relay's 404 codes on, without audit", async () => {
    const admin = await ctx.createAdmin("admin");
    const before = relay.state.calls.length;
    const noReason = await ctx.req("POST", `/admin/relay/rooms/${CODE}/close`, {
      token: admin.token,
      body: {},
    });
    expect(noReason.status).toBe(400);
    const badCode = await ctx.req("POST", "/admin/relay/rooms/0OIL1/close", {
      token: admin.token,
      body: { reason: "Test" },
    });
    expect(badCode.status).toBe(404);
    expect(badCode.json.error).toBe("room_not_found");
    expect(relay.state.calls.length).toBe(before);

    relay.state.handler = () =>
      json({ error: "room_not_found", message: "No such room" }, 404);
    const gone = await ctx.req("POST", `/admin/relay/rooms/${CODE}/close`, {
      token: admin.token,
      body: { reason: "Schon weg" },
    });
    expect(gone.status).toBe(404);
    expect(gone.json.error).toBe("room_not_found");

    relay.state.handler = () =>
      json({ error: "player_not_in_room", message: "x" }, 404);
    const missing = await ctx.req("POST", `/admin/relay/rooms/${CODE}/kick`, {
      token: admin.token,
      body: { playerId: randomUUID(), reason: "Test" },
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("player_not_in_room");

    const audit = await ctx.req(
      "GET",
      `/admin/audit?adminId=${admin.id}&actionPrefix=relay.`,
      { token: admin.token }
    );
    expect(audit.json.total).toBe(0);
  });

  it("answers 502 relay_unavailable when the relay is down, slow or answers nonsense", async () => {
    const admin = await ctx.createAdmin("admin");
    const cases: Handler[] = [
      () => {
        throw new TypeError("connection refused");
      },
      () => json({ error: "unauthorized" }, 401),
      () => json({ error: "not_found" }, 404),
      () => json({ rooms: "nope" }),
      () => new Response("<html>bad gateway</html>", { status: 502 }),
      hang,
    ];
    for (const handler of cases) {
      relay.state.handler = handler;
      const res = await ctx.req("GET", "/admin/relay/rooms", {
        token: admin.token,
      });
      expect(res.status).toBe(502);
      expect(res.json.error).toBe("relay_unavailable");
    }
  });

  it("a ban kicks the player at the relay (best effort)", async () => {
    const mod = await ctx.createAdmin("moderator");
    const p = await ctx.login();
    relay.state.handler = (call) =>
      json({
        playerId: call.url.pathname.split("/")[3],
        connections: 1,
        rooms: [CODE],
      });
    const ban = await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Cheating", durationDays: 1 },
    });
    expect(ban.status).toBe(201);
    expect(ban.json.relay).toBe("disconnected");
    expect(lastCall()).toMatchObject({ method: "POST" });
    expect(lastCall()?.url.pathname).toBe(`/internal/players/${p.id}/ban`);

    const q = await ctx.login();
    relay.state.handler = () =>
      json({ playerId: q.id, connections: 0, rooms: [] });
    const offline = await ctx.req("POST", `/admin/players/${q.id}/bans`, {
      token: mod.token,
      body: { reason: "Cheating", durationDays: null },
    });
    expect(offline.json.relay).toBe("not_connected");

    // Relay down: the ban itself still succeeds.
    const r = await ctx.login();
    relay.state.handler = () => {
      throw new TypeError("connection refused");
    };
    const down = await ctx.req("POST", `/admin/players/${r.id}/bans`, {
      token: mod.token,
      body: { reason: "Cheating", durationDays: 7 },
    });
    expect(down.status).toBe(201);
    expect(down.json.relay).toBe("unavailable");
    expect((await ctx.req("GET", "/me", { token: r.token })).json.error).toBe(
      "banned"
    );
  });
});

describe("admin: relay not configured", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("answers 501 relay_not_configured and bans skip the relay", async () => {
    const admin = await ctx.createAdmin("admin");
    const res = await ctx.req("GET", "/admin/relay/rooms", {
      token: admin.token,
    });
    expect(res.status).toBe(501);
    expect(res.json.error).toBe("relay_not_configured");
    const close = await ctx.req("POST", `/admin/relay/rooms/${CODE}/close`, {
      token: admin.token,
      body: { reason: "Test" },
    });
    expect(close.status).toBe(501);

    const p = await ctx.login();
    const ban = await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: admin.token,
      body: { reason: "Test", durationDays: 1 },
    });
    expect(ban.status).toBe(201);
    expect(ban.json.relay).toBe("not_configured");
  });

  it("refuses RELAY_INTERNAL_URL without RELAY_INTERNAL_KEY", () => {
    expect(() => testConfig({ RELAY_INTERNAL_URL: RELAY_URL })).toThrow(
      "RELAY_INTERNAL_URL needs RELAY_INTERNAL_KEY"
    );
  });
});
