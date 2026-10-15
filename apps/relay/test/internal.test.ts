import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  RELAY_CLOSE_CODES,
  RELAY_INTERNAL_PATHS,
  RELAY_KEY_HEADER,
  RELAY_ROOM_RATE_WINDOW_SECONDS,
  RelayBanPlayerResponse,
  RelayRoomList,
  RelayServerMessage,
} from "@soulwick/contracts";
import { createApiStatusSource } from "../src/auth.ts";
import { type RelayServer, startRelayServer } from "../src/server.ts";
import { RELAY_KEY, startFakeApi } from "./fake-api.ts";
import {
  createHarness,
  FakeStatusSource,
  FakeTransport,
  playerToken,
  silentLogger,
  testConfig,
} from "./helpers.ts";
import { testTokenVerifier } from "./jwt.ts";

const REASON = "Beleidigender Name";

describe("moderation in the relay core", () => {
  it("lists rooms with players, host flag, platform, age and traffic, without tokens", async () => {
    const h = createHarness();
    const host = await h.host("Host");
    h.advance(2000);
    const a = await h.player("Ash", { platform: "android" });
    await a.send({ type: "join", code: host.code });
    await host.send({ type: "start" });

    // 20 bytes from the host to everybody: 20 in, 20 out (one receiver).
    host.frame(
      0,
      Array.from({ length: 10 }, (_, i) => i)
    );
    h.advance(RELAY_ROOM_RATE_WINDOW_SECONDS * 1000);
    h.relay.sweep();

    const [room] = RelayRoomList.shape.rooms.parse(h.relay.listRooms());
    expect(room).toMatchObject({
      code: host.code,
      mode: "quick",
      guildId: null,
      started: true,
      gameVersion: "1.0.0",
      playerCount: 2,
      maxPlayers: 4,
      expiresAt: null,
      runsStarted: 1,
      ageSeconds: 2 + RELAY_ROOM_RATE_WINDOW_SECONDS,
    });
    expect(room?.players).toEqual([
      {
        peerId: 1,
        playerId: host.status.playerId,
        name: "Host",
        platform: "windows",
        host: true,
        inRoomSeconds: 2 + RELAY_ROOM_RATE_WINDOW_SECONDS,
      },
      {
        peerId: 2,
        playerId: a.status.playerId,
        name: "Ash",
        platform: "android",
        host: false,
        inRoomSeconds: RELAY_ROOM_RATE_WINDOW_SECONDS,
      },
    ]);
    const window = 2 + RELAY_ROOM_RATE_WINDOW_SECONDS;
    expect(room?.bytesInPerSecond).toBe(Math.round(20 / window));
    expect(room?.bytesOutPerSecond).toBe(Math.round(20 / window));
    expect(JSON.stringify(room)).not.toContain("token");
  });

  it("closes a room for everybody with room_closed (closed_by_admin), also during a run", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await host.send({ type: "start" });
    host.t.clear();
    a.t.clear();

    const result = h.relay.adminCloseRoom(host.code, REASON);
    expect(result).toEqual({
      code: host.code,
      playerIds: [host.status.playerId, a.status.playerId],
      started: true,
    });
    for (const p of [host, a]) {
      const closed = p.t.of("room_closed");
      expect(closed).toEqual([
        { type: "room_closed", code: host.code, reason: "closed_by_admin" },
      ]);
      // The added reason is part of the contract the game parses.
      expect(RelayServerMessage.safeParse(closed[0]).success).toBe(true);
      expect(p.t.of("peer_left")).toEqual([]);
      expect(p.t.closed).toBeNull();
    }
    expect(h.relay.rooms.size).toBe(0);
    expect(h.metrics.roomsClosed).toEqual({ closed_by_admin: 1 });
    expect(h.relay.adminCloseRoom(host.code, REASON)).toBeNull();

    // Both can create or join new rooms right away.
    await a.send({ type: "create", mode: "quick" });
    expect(a.t.of("created")).toHaveLength(1);
  });

  it("kicks a client like the host would; the player cannot come back", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    const b = await h.player("B");
    await a.send({ type: "join", code: host.code });
    await b.send({ type: "join", code: host.code });
    host.t.clear();
    b.t.clear();

    expect(h.relay.adminKick(host.code, a.status.playerId, REASON)).toEqual({
      code: host.code,
      playerId: a.status.playerId,
      peerId: 2,
      roomClosed: false,
    });
    expect(a.t.of("room_closed").at(-1)?.reason).toBe("kicked");
    for (const p of [host, b]) {
      expect(p.t.of("peer_left")).toEqual([
        { type: "peer_left", peerId: 2, reason: "kicked" },
      ]);
    }
    a.t.clear();
    await a.send({ type: "join", code: host.code });
    expect(a.t.errors()).toEqual(["kicked"]);

    expect(h.relay.adminKick(host.code, a.status.playerId, REASON)).toBe(
      "player_not_in_room"
    );
    expect(h.relay.adminKick("ZZZZZZ", a.status.playerId, REASON)).toBe(
      "room_not_found"
    );
  });

  it("kicking the host closes the room: host kicked, the others host_left", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    a.t.clear();

    expect(h.relay.adminKick(host.code, host.status.playerId, REASON)).toEqual({
      code: host.code,
      playerId: host.status.playerId,
      peerId: 1,
      roomClosed: true,
    });
    expect(host.t.of("room_closed").at(-1)?.reason).toBe("kicked");
    expect(a.t.of("room_closed")).toEqual([
      { type: "room_closed", code: host.code, reason: "host_left" },
    ]);
    expect(h.relay.rooms.size).toBe(0);
    expect(h.relay.stats().playersInRooms).toBe(0);
  });

  it("a ban closes every connection of the player with banned (4003) and forgets the status", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    host.t.clear();

    const result = h.relay.banPlayer(a.status.playerId);
    expect(RelayBanPlayerResponse.parse(result)).toEqual({
      playerId: a.status.playerId,
      connections: 1,
      rooms: [host.code],
    });
    expect(a.t.errors()).toEqual(["banned"]);
    expect(a.t.closed?.code).toBe(RELAY_CLOSE_CODES.banned);
    expect(host.t.of("peer_left")).toEqual([
      { type: "peer_left", peerId: 2, reason: "disconnected" },
    ]);
    expect(h.status.forgotten).toEqual([a.status.playerId]);

    // Banned host: the room closes for the others (host_left).
    const other = await h.player("Other");
    await other.send({ type: "join", code: host.code });
    other.t.clear();
    h.relay.banPlayer(host.status.playerId);
    expect(other.t.of("room_closed").at(-1)?.reason).toBe("host_left");

    expect(h.relay.banPlayer(randomUUID())).toMatchObject({
      connections: 0,
      rooms: [],
    });
  });
});

describe("API status cache: forget", () => {
  let api: ReturnType<typeof startFakeApi>;
  beforeAll(() => {
    api = startFakeApi();
  });
  afterAll(() => api.stop());

  it("asks the API again after forget, also when a lookup was in flight", async () => {
    const source = createApiStatusSource({
      apiUrl: api.url,
      key: RELAY_KEY,
      cacheMs: 60_000,
      timeoutMs: 1000,
      logger: silentLogger,
    });
    const p = api.add("Soon banned");
    expect(await source.get(p.playerId)).toMatchObject({
      status: { banned: false },
    });
    const before = api.state.calls;

    const status = api.players.get(p.playerId);
    if (!status) {
      throw new Error("missing fake player");
    }
    status.banned = true;
    source.forget?.(p.playerId);
    expect(await source.get(p.playerId)).toMatchObject({
      status: { banned: true },
    });
    expect(api.state.calls - before).toBe(1);

    // In flight while forgotten: the answer still arrives but is neither cached nor shared.
    api.state.delayMs = 50;
    const inflight = source.get(p.playerId);
    source.forget?.(p.playerId);
    const second = source.get(p.playerId);
    expect(second).not.toBe(inflight);
    await Promise.all([inflight, second]);
    api.state.delayMs = 0;
    const calls = api.state.calls;
    await source.get(p.playerId);
    expect(api.state.calls).toBe(calls);
  });
});

describe("internal HTTP endpoints", () => {
  let server: RelayServer;
  let status: FakeStatusSource;
  let base: string;
  const headers = { [RELAY_KEY_HEADER]: RELAY_KEY };

  beforeAll(() => {
    status = new FakeStatusSource();
    server = startRelayServer(testConfig({ RELAY_INTERNAL_KEY: RELAY_KEY }), {
      logger: silentLogger,
      status,
      tokens: testTokenVerifier(silentLogger),
      sweepIntervalMs: null,
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => server.stop());

  /** A greeted player on a fake transport inside the real server's relay. */
  async function player(name: string) {
    const s = status.add(name);
    const t = new FakeTransport();
    const client = server.relay.open(t);
    const send = (m: Record<string, unknown>) =>
      server.relay.handleText(client, JSON.stringify(m));
    await send({
      type: "hello",
      token: await playerToken(s.playerId),
      protocolVersion: 1,
      gameVersion: "1.0.0",
      platform: "linux",
    });
    return { s, t, send };
  }

  const post = (path: string, body: unknown, h = headers) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("needs the key: 401 without or with a wrong key", async () => {
    expect((await fetch(`${base}${RELAY_INTERNAL_PATHS.rooms}`)).status).toBe(
      401
    );
    const wrong = await fetch(`${base}${RELAY_INTERNAL_PATHS.rooms}`, {
      headers: { [RELAY_KEY_HEADER]: "wrong" },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: "unauthorized" });
  });

  it("lists, kicks and closes rooms; ban disconnects", async () => {
    const host = await player("HttpHost");
    await host.send({ type: "create", mode: "quick" });
    const code = host.t.of("created")[0]?.code ?? "";
    const guest = await player("HttpGuest");
    await guest.send({ type: "join", code: code.toLowerCase() });
    const third = await player("HttpThird");
    await third.send({ type: "join", code });

    const list = await fetch(`${base}${RELAY_INTERNAL_PATHS.rooms}`, {
      headers,
    });
    expect(list.status).toBe(200);
    const parsed = RelayRoomList.parse(await list.json());
    expect(parsed.protocolVersion).toBe(1);
    expect(parsed.rooms.map((r) => r.code)).toEqual([code]);
    expect(parsed.rooms[0]?.players.map((p) => p.name)).toEqual([
      "HttpHost",
      "HttpGuest",
      "HttpThird",
    ]);

    const badBody = await post(RELAY_INTERNAL_PATHS.kick(code), {
      playerId: "nope",
    });
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toMatchObject({ error: "validation_error" });
    const notJson = await fetch(`${base}${RELAY_INTERNAL_PATHS.kick(code)}`, {
      method: "POST",
      headers,
      body: "{",
    });
    expect(notJson.status).toBe(400);

    const missingPlayer = await post(RELAY_INTERNAL_PATHS.kick(code), {
      playerId: randomUUID(),
      reason: REASON,
    });
    expect(missingPlayer.status).toBe(404);
    expect(await missingPlayer.json()).toMatchObject({
      error: "player_not_in_room",
    });
    const missingRoom = await post(RELAY_INTERNAL_PATHS.closeRoom("ZZZZZZ"), {
      reason: REASON,
    });
    expect(missingRoom.status).toBe(404);
    expect(await missingRoom.json()).toMatchObject({ error: "room_not_found" });

    const kick = await post(RELAY_INTERNAL_PATHS.kick(code.toLowerCase()), {
      playerId: guest.s.playerId,
      reason: REASON,
    });
    expect(kick.status).toBe(200);
    expect(await kick.json()).toMatchObject({ peerId: 2, roomClosed: false });
    expect(guest.t.of("room_closed").at(-1)?.reason).toBe("kicked");

    const ban = await post(
      RELAY_INTERNAL_PATHS.banPlayer(third.s.playerId),
      {}
    );
    expect(await ban.json()).toEqual({
      playerId: third.s.playerId,
      connections: 1,
      rooms: [code],
    });
    expect(third.t.closed?.code).toBe(RELAY_CLOSE_CODES.banned);

    const close = await post(RELAY_INTERNAL_PATHS.closeRoom(code), {
      reason: REASON,
    });
    expect(close.status).toBe(200);
    expect(await close.json()).toEqual({
      code,
      playerIds: [host.s.playerId],
      started: false,
    });
    expect(host.t.of("room_closed").at(-1)?.reason).toBe("closed_by_admin");
    expect(server.relay.rooms.size).toBe(0);

    const tooShort = await post(RELAY_INTERNAL_PATHS.closeRoom(code), {
      reason: "x",
    });
    expect(tooShort.status).toBe(400);
  });

  it("is disabled (404) without RELAY_INTERNAL_KEY", async () => {
    const off = startRelayServer(testConfig(), {
      logger: silentLogger,
      status: new FakeStatusSource(),
      sweepIntervalMs: null,
    });
    try {
      const res = await fetch(
        `http://127.0.0.1:${off.port}${RELAY_INTERNAL_PATHS.rooms}`,
        { headers }
      );
      expect(res.status).toBe(404);
    } finally {
      await off.stop();
    }
  });
});
