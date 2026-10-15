import { describe, expect, it } from "bun:test";
import { MAX_ROOM_PLAYERS, RELAY_CLOSE_CODES } from "@soulwick/contracts";
import { createHarness, inOrder, playerToken } from "./helpers.ts";

describe("room lifecycle", () => {
  it("creates a room with the creator as host (peer 1)", async () => {
    const h = createHarness();
    const host = await h.player("Host", { platform: "android" });
    await host.send({ type: "create", mode: "quick" });
    const created = host.t.of("created")[0];
    expect(created?.peerId).toBe(1);
    expect(created?.room).toMatchObject({
      mode: "quick",
      guildId: null,
      hostPeerId: 1,
      started: false,
      maxPlayers: MAX_ROOM_PLAYERS,
      gameVersion: "1.0.0",
      peers: [
        {
          peerId: 1,
          playerId: host.status.playerId,
          name: "Host",
          platform: "android",
        },
      ],
    });
    expect(created?.room.expiresAt).toBe(
      new Date(h.now() + 10 * 60_000).toISOString()
    );
    expect(host.t.of("room_state")).toHaveLength(1);
    expect(h.relay.stats()).toMatchObject({ rooms: 1, playersInRooms: 1 });
  });

  it("lets clients join by code with increasing peer ids and informs everybody", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("Ash");
    await a.send({ type: "join", code: host.code.toLowerCase() });
    const joined = a.t.of("joined")[0];
    expect(joined?.peerId).toBe(2);
    expect(joined?.room.peers.map((p) => p.peerId)).toEqual([1, 2]);
    expect(host.t.of("peer_joined")[0]?.peer).toMatchObject({
      peerId: 2,
      name: "Ash",
    });

    const b = await h.player("Birch");
    await b.send({ type: "join", code: host.code });
    expect(b.t.of("joined")[0]?.peerId).toBe(3);
    expect(a.t.of("peer_joined").map((m) => m.peer.peerId)).toEqual([3]);
    expect(host.t.of("room_state").at(-1)?.room.peers).toHaveLength(3);
  });

  it("rejects a fifth player with room_full and unknown codes with room_not_found", async () => {
    const h = createHarness();
    const host = await h.host();
    await inOrder(["A1", "A2", "A3"], async (name) => {
      const p = await h.player(name);
      await p.send({ type: "join", code: host.code });
      expect(p.t.of("joined")).toHaveLength(1);
    });
    const fifth = await h.player("A4");
    await fifth.send({ type: "join", code: host.code });
    expect(fifth.t.errors()).toEqual(["room_full"]);
    await fifth.send({ type: "join", code: "ZZZZZZ" });
    expect(fifth.t.errors()).toEqual(["room_full", "room_not_found"]);
  });

  it("never reuses peer ids within a room", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await a.send({ type: "leave" });
    expect(a.t.of("room_closed")[0]?.reason).toBe("left");
    expect(host.t.of("peer_left")[0]).toEqual({
      type: "peer_left",
      peerId: 2,
      reason: "left",
    });
    const b = await h.player("B");
    await b.send({ type: "join", code: host.code });
    expect(b.t.of("joined")[0]?.peerId).toBe(3);
    await a.send({ type: "join", code: host.code });
    expect(a.t.of("joined").at(-1)?.peerId).toBe(4);
  });

  it("closes the room for everybody when the host leaves or disconnects (D-085)", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await host.send({ type: "leave" });
    expect(host.t.of("room_closed")[0]?.reason).toBe("left");
    expect(a.t.of("room_closed")[0]).toEqual({
      type: "room_closed",
      code: host.code,
      reason: "host_left",
    });
    expect(h.relay.rooms.size).toBe(0);
    // The client's connection stays usable.
    await a.send({ type: "create", mode: "quick" });
    const code = a.t.of("created")[0]?.code;
    expect(code).toBeString();

    const b = await h.player("B");
    await b.send({ type: "join", code });
    h.relay.handleClose(a.client, 1006, "");
    expect(b.t.of("room_closed")[0]?.reason).toBe("host_left");
    expect(h.relay.rooms.size).toBe(0);
  });

  it("keeps the room when a client disconnects", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    h.relay.handleClose(a.client, 1006, "");
    expect(host.t.of("peer_left")[0]).toEqual({
      type: "peer_left",
      peerId: 2,
      reason: "disconnected",
    });
    expect(h.relay.rooms.get(host.code)?.members.size).toBe(1);
  });

  it("expires unstarted rooms after 10 minutes, but not started ones", async () => {
    const h = createHarness();
    const lobby = await h.host("Lobby");
    const running = await h.host("Running");
    await running.send({ type: "start" });
    // Keep the connections alive for the heartbeat while time passes.
    for (let i = 0; i < 40; i += 1) {
      h.advance(15_000);
      h.relay.handlePong(lobby.client);
      h.relay.handlePong(running.client);
      h.relay.sweep();
      expect(h.relay.rooms.has(lobby.code)).toBe(i < 39);
    }
    expect(lobby.t.of("room_closed")[0]?.reason).toBe("expired");
    expect(lobby.client.closed).toBe(false);
    expect(h.relay.rooms.has(running.code)).toBe(true);
    expect(h.metrics.roomsClosed).toEqual({ expired: 1 });
  });

  it("start: host only, blocks further joins, informs everybody", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await a.send({ type: "start" });
    expect(a.t.errors()).toEqual(["not_host"]);
    await host.send({ type: "start" });
    expect(host.t.of("started")).toHaveLength(1);
    expect(a.t.of("started")).toHaveLength(1);
    expect(a.t.of("room_state").at(-1)?.room).toMatchObject({
      started: true,
      expiresAt: null,
    });
    await host.send({ type: "start" });
    expect(host.t.errors()).toEqual(["room_started"]);
    const late = await h.player("Late");
    await late.send({ type: "join", code: host.code });
    expect(late.t.errors()).toEqual(["room_started"]);
  });

  it("kick: host only, target gets room_closed(kicked) and cannot rejoin", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    const b = await h.player("B");
    await a.send({ type: "join", code: host.code });
    await b.send({ type: "join", code: host.code });
    await a.send({ type: "kick", peerId: 3 });
    expect(a.t.errors()).toEqual(["not_host"]);
    await host.send({ type: "kick", peerId: 1 });
    await host.send({ type: "kick", peerId: 9 });
    expect(host.t.errors()).toEqual(["peer_not_found", "peer_not_found"]);

    await host.send({ type: "kick", peerId: 2 });
    expect(a.t.of("room_closed")[0]).toEqual({
      type: "room_closed",
      code: host.code,
      reason: "kicked",
    });
    expect(b.t.of("peer_left").at(-1)).toEqual({
      type: "peer_left",
      peerId: 2,
      reason: "kicked",
    });
    expect(host.t.of("peer_left").at(-1)?.reason).toBe("kicked");
    await a.send({ type: "join", code: host.code });
    expect(a.t.errors()).toEqual(["not_host", "kicked"]);
  });

  it("allows one room per player, also across connections", async () => {
    const h = createHarness();
    const host = await h.host();
    await host.send({ type: "create", mode: "quick" });
    await host.send({ type: "join", code: host.code });
    expect(host.t.errors()).toEqual(["already_in_room", "already_in_room"]);

    // Same player on a second connection.
    const second = h.connect();
    await second.send({
      type: "hello",
      token: await playerToken(host.status.playerId),
      protocolVersion: h.config.PROTOCOL_VERSION,
      gameVersion: "1.0.0",
      platform: "linux",
    });
    expect(second.t.of("welcome")).toHaveLength(1);
    await second.send({ type: "create", mode: "quick" });
    expect(second.t.errors()).toEqual(["already_in_room"]);
  });

  it("rejects joining with another game version", async () => {
    const h = createHarness();
    const host = await h.host();
    const old = await h.player("Old", { gameVersion: "0.9.0" });
    await old.send({ type: "join", code: host.code });
    expect(old.t.errors()).toEqual(["version_mismatch"]);
    expect(old.client.closed).toBe(false);
  });

  it("answers leave/start/kick outside a room with not_in_room and ping with pong", async () => {
    const h = createHarness();
    const p = await h.player("P");
    await p.send({ type: "leave" });
    await p.send({ type: "start" });
    await p.send({ type: "kick", peerId: 2 });
    expect(p.t.errors()).toEqual(["not_in_room", "not_in_room", "not_in_room"]);
    await p.send({ type: "ping", t: 42 });
    expect(p.t.last()).toEqual({ type: "pong", t: 42 });
  });

  it("shutdown closes rooms (shutdown) and connections (1001)", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    h.relay.shutdown();
    expect(a.t.of("room_closed")[0]?.reason).toBe("shutdown");
    expect(a.t.closed?.code).toBe(RELAY_CLOSE_CODES.shutdown);
    expect(host.t.closed?.code).toBe(RELAY_CLOSE_CODES.shutdown);
    expect(h.relay.stats()).toMatchObject({ rooms: 0, connections: 0 });
  });
});

describe("several runs per room (end_run)", () => {
  it("start -> end_run -> a new player joins -> start again; everybody is informed", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await host.send({ type: "start" });
    host.t.clear();
    a.t.clear();

    h.advance(30 * 60_000);
    await host.send({ type: "end_run", reason: "portal" });
    for (const peer of [host, a]) {
      expect(peer.t.of("run_ended")).toEqual([
        { type: "run_ended", reason: "portal" },
      ]);
      expect(peer.t.messages.map((m) => m.type)).toEqual([
        "run_ended",
        "room_state",
      ]);
      expect(peer.t.of("room_state").at(-1)?.room).toMatchObject({
        started: false,
        expiresAt: new Date(h.now() + 10 * 60_000).toISOString(),
      });
    }
    expect(host.t.errors()).toEqual([]);

    const b = await h.player("B");
    await b.send({ type: "join", code: host.code });
    expect(b.t.of("joined")[0]?.peerId).toBe(3);
    expect(b.t.of("joined")[0]?.room.started).toBe(false);
    expect(host.t.of("peer_joined").at(-1)?.peer.peerId).toBe(3);
    expect(a.t.of("peer_joined").at(-1)?.peer.peerId).toBe(3);

    await host.send({ type: "start" });
    for (const peer of [host, a, b]) {
      expect(peer.t.of("started")).toHaveLength(1);
      expect(peer.t.of("room_state").at(-1)?.room).toMatchObject({
        started: true,
        expiresAt: null,
        peers: [{ peerId: 1 }, { peerId: 2 }, { peerId: 3 }],
      });
    }
    expect(host.t.errors()).toEqual([]);
    const late = await h.player("Late");
    await late.send({ type: "join", code: host.code });
    expect(late.t.errors()).toEqual(["room_started"]);
  });

  it("sends reason null when the host names none", async () => {
    const h = createHarness();
    const host = await h.host();
    await host.send({ type: "start" });
    await host.send({ type: "end_run" });
    expect(host.t.of("run_ended")).toEqual([
      { type: "run_ended", reason: null },
    ]);
  });

  it("end_run: host only, only during a run, not outside a room", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await host.send({ type: "end_run", reason: "wiped" });
    expect(host.t.errors()).toEqual(["room_not_started"]);
    expect(host.t.of("error")[0]?.request).toBe("end_run");

    await host.send({ type: "start" });
    await a.send({ type: "end_run" });
    expect(a.t.errors()).toEqual(["not_host"]);
    expect(h.relay.rooms.get(host.code)?.started).toBe(true);
    expect(a.t.of("run_ended")).toHaveLength(0);

    await host.send({ type: "end_run", reason: "abandoned" });
    await host.send({ type: "end_run", reason: "abandoned" });
    expect(host.t.errors()).toEqual(["room_not_started", "room_not_started"]);
    expect(a.t.of("run_ended")).toHaveLength(1);

    const outside = await h.player("Outside");
    await outside.send({ type: "end_run" });
    expect(outside.t.errors()).toEqual(["not_in_room"]);
    await outside.send({ type: "end_run", reason: "won" });
    expect(outside.t.errors()).toEqual(["not_in_room", "invalid_message"]);
  });

  it("keeps kicked players out between runs and respects size and version", async () => {
    const h = createHarness();
    const host = await h.host();
    const a = await h.player("A");
    await a.send({ type: "join", code: host.code });
    await host.send({ type: "kick", peerId: 2 });
    await host.send({ type: "start" });
    await host.send({ type: "end_run", reason: "wiped" });

    await a.send({ type: "join", code: host.code });
    expect(a.t.errors()).toEqual(["kicked"]);
    const old = await h.player("Old", { gameVersion: "0.9.0" });
    await old.send({ type: "join", code: host.code });
    expect(old.t.errors()).toEqual(["version_mismatch"]);
    await inOrder(["B", "C", "D"], async (name) => {
      const p = await h.player(name);
      await p.send({ type: "join", code: host.code });
      expect(p.t.of("joined")).toHaveLength(1);
    });
    const fifth = await h.player("E");
    await fifth.send({ type: "join", code: host.code });
    expect(fifth.t.errors()).toEqual(["room_full"]);
  });

  it("restarts the lobby expiry after end_run", async () => {
    const h = createHarness();
    const host = await h.host();
    await host.send({ type: "start" });
    h.advance(60 * 60_000);
    h.relay.handlePong(host.client);
    h.relay.sweep();
    expect(h.relay.rooms.has(host.code)).toBe(true);

    await host.send({ type: "end_run", reason: "portal" });
    for (let i = 0; i < 40; i += 1) {
      h.advance(15_000);
      h.relay.handlePong(host.client);
      h.relay.sweep();
      expect(h.relay.rooms.has(host.code)).toBe(i < 39);
    }
    expect(host.t.of("room_closed")[0]?.reason).toBe("expired");
  });
});
