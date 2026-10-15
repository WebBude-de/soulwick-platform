import { describe, expect, it } from "bun:test";
import { RELAY_CLOSE_CODES } from "@soulwick/contracts";
import type { Logger } from "../src/logger.ts";
import { Metrics } from "../src/metrics.ts";
import { Relay } from "../src/relay.ts";
import {
  createHarness,
  FakeStatusSource,
  FakeTransport,
  playerToken,
  silentLogger,
  testConfig,
} from "./helpers.ts";
import { testTokenVerifier } from "./jwt.ts";

/**
 * Connection stability during a long shared run (first online test, 15.10.2026): the relay must
 * not drop a healthy connection because of time alone (JWT lifetime, room age), and every close
 * must be explainable from the log.
 */
describe("long sessions", () => {
  it("keeps a started room alive for 40 minutes while pongs arrive (the 15 min JWT is only checked at hello)", async () => {
    let wall = Date.now();
    const h = createHarness({}, { tokenNow: () => wall });
    const host = await h.host();
    const guest = await h.player("Guest");
    await guest.send({ type: "join", code: host.code });
    await host.send({ type: "start" });
    host.t.clear();
    guest.t.clear();
    for (let i = 0; i < 160; i += 1) {
      h.advance(15_000);
      wall += 15_000;
      h.relay.handlePong(host.client);
      h.relay.handlePong(guest.client);
      h.relay.sweep();
    }
    expect(host.client.closed).toBe(false);
    expect(guest.client.closed).toBe(false);
    expect(h.relay.rooms.get(host.code)?.members.size).toBe(2);
    guest.frame(1, [1, 2, 3]);
    expect(host.t.frames).toHaveLength(1);
    expect(host.t.of("room_closed")).toHaveLength(0);
  });

  it("game packets alone count as a sign of life (no pong needed)", async () => {
    const h = createHarness();
    const host = await h.host();
    const guest = await h.player("Guest");
    await guest.send({ type: "join", code: host.code });
    for (let i = 0; i < 20; i += 1) {
      h.advance(10_000);
      host.frame(0, [i]);
      guest.frame(1, [i]);
      h.relay.sweep();
    }
    expect(host.client.closed).toBe(false);
    expect(guest.client.closed).toBe(false);
  });

  it("answers the game's heartbeat ping with pong and the same t", async () => {
    const h = createHarness();
    const p = await h.player("P");
    h.advance(29_000);
    await p.send({ type: "ping", t: 1234 });
    expect(p.t.of("pong")[0]).toEqual({ type: "pong", t: 1234 });
    h.advance(29_000);
    h.relay.sweep();
    expect(p.client.closed).toBe(false);
  });

  it("a silent guest times out (4000) and the host keeps the room", async () => {
    const h = createHarness();
    const host = await h.host();
    const guest = await h.player("Guest");
    await guest.send({ type: "join", code: host.code });
    for (let i = 0; i < 3; i += 1) {
      h.advance(15_000);
      h.relay.handlePong(host.client);
      h.relay.sweep();
    }
    expect(guest.t.closed?.code).toBe(RELAY_CLOSE_CODES.timeout);
    expect(host.t.of("peer_left")[0]).toMatchObject({
      peerId: 2,
      reason: "disconnected",
    });
    expect(h.relay.rooms.has(host.code)).toBe(true);
  });
});

describe("diagnostics", () => {
  function loggedRelay() {
    const lines: { msg: string; fields: Record<string, unknown> }[] = [];
    const logger: Logger = {
      info: (msg, fields = {}) => lines.push({ msg, fields }),
      error: (msg, fields = {}) => lines.push({ msg, fields }),
    };
    let clock = 5_000_000;
    const status = new FakeStatusSource();
    const metrics = new Metrics(clock);
    const relay = new Relay(testConfig(), {
      logger,
      metrics,
      status,
      tokens: testTokenVerifier(silentLogger),
      now: () => clock,
    });
    async function player(name: string) {
      const s = status.add(name);
      const t = new FakeTransport();
      const client = relay.open(t);
      await relay.handleText(
        client,
        JSON.stringify({
          type: "hello",
          token: await playerToken(s.playerId),
          protocolVersion: testConfig().PROTOCOL_VERSION,
          gameVersion: "1.0.0",
          platform: "windows",
        })
      );
      return { client, t };
    }
    return {
      lines,
      metrics,
      relay,
      player,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("connection_close names room, peer, silence and the largest frame", async () => {
    const r = loggedRelay();
    const host = await r.player("Host");
    await r.relay.handleText(
      host.client,
      JSON.stringify({ type: "create", mode: "quick" })
    );
    const code = host.t.of("created")[0]?.code;
    const guest = await r.player("Guest");
    await r.relay.handleText(
      guest.client,
      JSON.stringify({ type: "join", code })
    );
    r.relay.handleBinary(guest.client, new Uint8Array(10 + 500));
    r.advance(7000);
    r.relay.handleClose(guest.client, 1006, "");
    const close = r.lines.find((l) => l.msg === "connection_close");
    expect(close?.fields).toMatchObject({
      code: 1006,
      room: code,
      peerId: 2,
      started: false,
      silentMs: 7000,
      maxFrameIn: 510,
    });
    expect(r.metrics.maxFrameIn).toBe(510);
  });

  it("shutdown is logged with the open rooms before room_closed goes out", async () => {
    const r = loggedRelay();
    const host = await r.player("Host");
    await r.relay.handleText(
      host.client,
      JSON.stringify({ type: "create", mode: "quick" })
    );
    r.relay.shutdown();
    const shutdown = r.lines.find((l) => l.msg === "shutdown");
    expect(shutdown?.fields).toMatchObject({ rooms: 1, playersInRooms: 1 });
    // The reason arrives before the close frame, so the game can say "server restarts".
    expect(host.t.of("room_closed")[0]?.reason).toBe("shutdown");
    expect(host.t.closed?.code).toBe(RELAY_CLOSE_CODES.shutdown);
  });

  it("slow_consumer logs the buffered bytes", async () => {
    const r = loggedRelay();
    const host = await r.player("Host");
    await r.relay.handleText(
      host.client,
      JSON.stringify({ type: "create", mode: "quick" })
    );
    const code = host.t.of("created")[0]?.code;
    const guest = await r.player("Guest");
    await r.relay.handleText(
      guest.client,
      JSON.stringify({ type: "join", code })
    );
    guest.t.buffered = 2 * 1_048_576;
    const frame = new Uint8Array(10 + 4);
    frame[9] = 2;
    r.relay.handleBinary(host.client, frame);
    expect(guest.t.closed?.code).toBe(RELAY_CLOSE_CODES.slowConsumer);
    const slow = r.lines.find((l) => l.msg === "slow_consumer");
    expect(slow?.fields).toMatchObject({ buffered: 2 * 1_048_576 });
  });
});
