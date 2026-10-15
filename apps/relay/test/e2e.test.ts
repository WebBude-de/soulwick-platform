import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  decodeRelayFrame,
  encodeRelayFrame,
  PROTOCOL_VERSION,
  RELAY_KEY_HEADER,
  type RelayPlayerStatus,
  type RelayServerMessage,
} from "@soulwick/contracts";
import { sleep } from "bun";
import { type RelayServer, startRelayServer } from "../src/server.ts";
import { RELAY_KEY, startFakeApi } from "./fake-api.ts";
import { inOrder, playerToken, silentLogger, testConfig } from "./helpers.ts";

/** Polls `get` every 5 ms until it returns a value. */
async function waitFor<T>(
  get: () => T | undefined,
  end = Date.now() + 3000
): Promise<T> {
  const value = get();
  if (value !== undefined) {
    return value;
  }
  if (Date.now() > end) {
    throw new Error("timed out waiting");
  }
  await sleep(5);
  return waitFor(get, end);
}

/** Minimal game-side client over a real WebSocket. */
class TestClient {
  readonly messages: RelayServerMessage[] = [];
  readonly frames: Uint8Array[] = [];
  closeCode: number | null = null;
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        this.messages.push(JSON.parse(event.data) as RelayServerMessage);
      } else {
        this.frames.push(new Uint8Array(event.data as ArrayBuffer));
      }
    });
    ws.addEventListener("close", (event) => {
      this.closeCode = event.code;
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("ws error")), {
        once: true,
      });
    });
    return new TestClient(ws);
  }

  send(message: Record<string, unknown>) {
    this.ws.send(JSON.stringify(message));
  }

  sendFrame(to: number, data: number[], from = 0) {
    this.ws.send(
      encodeRelayFrame({
        from,
        to,
        channel: 0,
        mode: 2,
        data: Uint8Array.from(data),
      })
    );
  }

  /** Removes and returns the first message of this type (waits for it). */
  take<T extends RelayServerMessage["type"]>(
    type: T
  ): Promise<Extract<RelayServerMessage, { type: T }>> {
    return waitFor(() => {
      const i = this.messages.findIndex((m) => m.type === type);
      if (i < 0) {
        return;
      }
      const [found] = this.messages.splice(i, 1);
      return found as Extract<RelayServerMessage, { type: T }>;
    });
  }

  takeFrame() {
    return waitFor(() => this.frames.shift());
  }

  async hello(status: RelayPlayerStatus) {
    this.send({
      type: "hello",
      token: await playerToken(status.playerId),
      protocolVersion: PROTOCOL_VERSION,
      gameVersion: "1.0.0",
      platform: "linux",
    });
    return await this.take("welcome");
  }

  close() {
    this.ws.close();
  }
}

describe("relay end to end (real WebSocket, fake API)", () => {
  let api: ReturnType<typeof startFakeApi>;
  let relay: RelayServer;
  let wsUrl: string;
  let httpUrl: string;
  const clients: TestClient[] = [];

  const connect = async () => {
    const c = await TestClient.connect(wsUrl);
    clients.push(c);
    return c;
  };

  beforeAll(() => {
    api = startFakeApi();
    relay = startRelayServer(
      testConfig({
        API_INTERNAL_URL: api.url,
        RELAY_INTERNAL_KEY: RELAY_KEY,
        MAX_CONNECTIONS_PER_IP_PER_MINUTE: "100",
      }),
      { logger: silentLogger }
    );
    httpUrl = `http://127.0.0.1:${relay.port}`;
    wsUrl = `ws://127.0.0.1:${relay.port}/v1`;
  });
  afterAll(async () => {
    for (const c of clients) {
      c.close();
    }
    await relay.stop();
    await api.stop();
  });

  it("host and three clients meet by code and exchange binary frames", async () => {
    const health = await (await fetch(`${httpUrl}/health`)).json();
    expect(health).toMatchObject({
      status: "ok",
      protocolVersion: 1,
      rooms: 0,
    });

    const host = await connect();
    const welcome = await host.hello(api.add("Host"));
    expect(welcome.name).toBe("Host");
    // The JWT was checked against the API's JWKS (P-027), fetched once and cached.
    expect(api.state.jwksCalls).toBe(1);
    host.send({ type: "create", mode: "quick" });
    const { code } = await host.take("created");

    const guests = await inOrder(["Ash", "Birch", "Cedar"], async (name, i) => {
      const c = await connect();
      await c.hello(api.add(name));
      c.send({ type: "join", code });
      const joined = await c.take("joined");
      expect(joined.peerId).toBe(i + 2);
      return c;
    });
    const joinedPeers = await inOrder([2, 3, 4], async () =>
      host.take("peer_joined")
    );
    expect(joinedPeers.map((m) => m.peer.peerId)).toEqual([2, 3, 4]);
    host.send({ type: "start" });
    await Promise.all([host, ...guests].map((c) => c.take("started")));

    // Host broadcast reaches all clients, stamped with from = 1.
    host.sendFrame(0, [1, 2, 3], 77);
    const broadcast = await Promise.all(guests.map((c) => c.takeFrame()));
    for (const bytes of broadcast) {
      const f = decodeRelayFrame(bytes);
      expect(f && { ...f, data: [...f.data] }).toEqual({
        from: 1,
        to: 0,
        channel: 0,
        mode: 2,
        data: [1, 2, 3],
      });
    }

    // Each client to the host; the relay sets the real sender.
    for (const [i, c] of guests.entries()) {
      c.sendFrame(1, [i + 2], 1);
    }
    const toHost = await inOrder([0, 1, 2], () => host.takeFrame());
    const received = toHost.map((bytes) => {
      const f = decodeRelayFrame(bytes);
      return [f?.from, f?.data[0]];
    });
    expect(received.sort()).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ]);

    // Host to peer 3 only.
    host.sendFrame(3, [9]);
    expect(
      decodeRelayFrame((await guests[1]?.takeFrame()) ?? new Uint8Array())
        ?.data[0]
    ).toBe(9);
    await sleep(50);
    expect(guests[0]?.frames).toHaveLength(0);
    expect(guests[2]?.frames).toHaveLength(0);

    const during = await (await fetch(`${httpUrl}/health`)).json();
    expect(during).toMatchObject({ rooms: 1, players: 4, connections: 4 });

    const noKey = await fetch(`${httpUrl}/metrics`);
    expect(noKey.status).toBe(404);
    const metricsRes = await fetch(`${httpUrl}/metrics`, {
      headers: { [RELAY_KEY_HEADER]: RELAY_KEY },
    });
    const metrics = (await metricsRes.json()) as {
      framesIn: number;
      framesOut: number;
    };
    expect(metrics.framesIn).toBeGreaterThanOrEqual(5);
    expect(metrics.framesOut).toBeGreaterThanOrEqual(7);

    // Run over, back in the village: everybody gets run_ended, then the next run starts.
    host.send({ type: "end_run", reason: "portal" });
    const ended = await Promise.all(
      [host, ...guests].map((c) => c.take("run_ended"))
    );
    expect(ended.map((m) => m.reason)).toEqual([
      "portal",
      "portal",
      "portal",
      "portal",
    ]);
    host.send({ type: "start" });
    await Promise.all([host, ...guests].map((c) => c.take("started")));

    // Host goes away: everybody else gets host_left (D-085).
    host.close();
    const closed = await Promise.all(guests.map((c) => c.take("room_closed")));
    expect(closed.map((m) => m.reason)).toEqual([
      "host_left",
      "host_left",
      "host_left",
    ]);
    await waitFor(() => (relay.relay.rooms.size === 0 ? true : undefined));
  });

  it("checks guild membership through the internal API", async () => {
    const guildId = randomUUID();
    const founder = await connect();
    await founder.hello(api.add("Founder", { guildId }));
    founder.send({ type: "create", mode: "guild", guildId });
    const { code } = await founder.take("created");

    const outsider = await connect();
    await outsider.hello(api.add("Outsider"));
    outsider.send({ type: "join", code });
    expect((await outsider.take("error")).code).toBe("not_guild_member");

    const member = await connect();
    await member.hello(api.add("Member", { guildId }));
    member.send({ type: "join", code });
    expect((await member.take("joined")).room.guildId).toBe(guildId);
  });

  it("closes banned players and rejects plain HTTP on the WebSocket path", async () => {
    const banned = await connect();
    banned.send({
      type: "hello",
      token: await playerToken(api.add("Banned", { banned: true }).playerId),
      protocolVersion: PROTOCOL_VERSION,
      gameVersion: "1.0.0",
      platform: "android",
    });
    expect((await banned.take("error")).code).toBe("banned");
    expect(await waitFor(() => banned.closeCode ?? undefined)).toBe(4003);

    expect((await fetch(`${httpUrl}/v1`)).status).toBe(426);
    expect((await fetch(`${httpUrl}/nope`)).status).toBe(404);
  });
});

describe("relay connection limit per IP", () => {
  it("answers 429 above MAX_CONNECTIONS_PER_IP_PER_MINUTE", async () => {
    const server = startRelayServer(
      testConfig({ MAX_CONNECTIONS_PER_IP_PER_MINUTE: "2" }),
      { logger: silentLogger, sweepIntervalMs: null }
    );
    const url = `ws://127.0.0.1:${server.port}/v1`;
    const a = await TestClient.connect(url);
    const b = await TestClient.connect(url);
    await expect(TestClient.connect(url)).rejects.toThrow();
    expect(server.metrics.connectionsRejected).toBe(1);
    a.close();
    b.close();
    await server.stop();
  });
});
