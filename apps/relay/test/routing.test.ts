import { describe, expect, it } from "bun:test";
import { decodeRelayFrame, RELAY_CLOSE_CODES } from "@soulwick/contracts";
import { createHarness, inOrder, type Peer } from "./helpers.ts";

/** Host plus `clients` joined clients (peer ids 2..). */
async function room(clients: number, overrides: Record<string, string> = {}) {
  const h = createHarness(overrides);
  const host = await h.host();
  const names = Array.from({ length: clients }, (_, i) => `C${i + 2}`);
  const peers: Peer[] = await inOrder(names, async (name) => {
    const p = await h.player(name);
    await p.send({ type: "join", code: host.code });
    return p;
  });
  host.t.clear();
  for (const p of peers) {
    p.t.clear();
  }
  // Refill the rate-limit buckets used by hello/create/join.
  h.advance(2000);
  const peer = (i: number): Peer => {
    const found = peers[i];
    if (!found) {
      throw new Error(`no peer ${i}`);
    }
    return found;
  };
  return { h, host, peers, peer };
}

const decoded = (frames: Uint8Array[]) =>
  frames.map((f) => {
    const d = decodeRelayFrame(f);
    return d && { ...d, data: [...d.data] };
  });

describe("frame routing", () => {
  it("client to host: relay sets from, keeps to/channel/mode/data", async () => {
    const { host, peers, peer } = await room(2);
    const a = peer(0);
    a.frame(1, [7, 8, 9], { from: 99, channel: 3, mode: 0 });
    expect(decoded(host.t.frames)).toEqual([
      { from: 2, to: 1, channel: 3, mode: 0, data: [7, 8, 9] },
    ]);
    expect(peers[1]?.t.frames).toHaveLength(0);
    expect(a.t.frames).toHaveLength(0);
  });

  it("host to one client", async () => {
    const { host, peers } = await room(3);
    host.frame(3, [1]);
    expect(peers.map((p) => p.t.frames.length)).toEqual([0, 1, 0]);
    expect(decoded(peers[1]?.t.frames ?? [])[0]).toMatchObject({
      from: 1,
      to: 3,
    });
  });

  it("host broadcast (0) reaches every client but not the host", async () => {
    const { host, peers } = await room(3);
    host.frame(0, [5]);
    expect(peers.map((p) => p.t.frames.length)).toEqual([1, 1, 1]);
    expect(host.t.frames).toHaveLength(0);
  });

  it("negative target = everybody except -to", async () => {
    const { host, peers } = await room(3);
    host.frame(-3, [5]);
    expect(peers.map((p) => p.t.frames.length)).toEqual([1, 0, 1]);
  });

  it("host_only: clients may not address other clients or broadcast", async () => {
    const { host, peer } = await room(2);
    const a = peer(0);
    const b = peer(1);
    a.frame(3, [1]);
    a.frame(0, [1]);
    expect(b.t.frames).toHaveLength(0);
    expect(host.t.frames).toHaveLength(0);
    // Second notice within a second is throttled.
    expect(a.t.errors()).toEqual(["invalid_target"]);
  });

  it("any: clients may address clients and broadcast", async () => {
    const { host, peer } = await room(2, { CLIENT_ROUTING: "any" });
    const a = peer(0);
    const b = peer(1);
    a.frame(3, [1]);
    expect(decoded(b.t.frames)[0]).toMatchObject({ from: 2, to: 3 });
    a.frame(0, [2]);
    expect(host.t.frames).toHaveLength(1);
    expect(b.t.frames).toHaveLength(2);
    expect(a.t.frames).toHaveLength(0);
  });

  it("drops frames for unknown peers and frames outside a room silently", async () => {
    const { h, host, peers } = await room(1);
    host.frame(7, [1]);
    expect(host.t.errors()).toEqual([]);
    expect(peers[0]?.t.frames).toHaveLength(0);
    expect(h.metrics.framesDropped.unknown_target).toBe(1);

    const lonely = await h.player("Lonely");
    lonely.frame(1, [1]);
    expect(lonely.t.errors()).toEqual([]);
    expect(h.metrics.framesDropped.not_in_room).toBe(1);
  });

  it("drops frames shorter than the header", async () => {
    const { h, host } = await room(1);
    h.relay.handleBinary(host.client, new Uint8Array([1, 0, 0]));
    expect(host.t.errors()).toEqual(["invalid_message"]);
  });
});

describe("limits", () => {
  it("drops oversize frames with frame_too_large and keeps the connection", async () => {
    const { h, host, peers } = await room(1, { MAX_FRAME_BYTES: "1024" });
    host.frame(2, new Array(1024 - 10).fill(1));
    expect(peers[0]?.t.frames).toHaveLength(1);
    host.frame(2, new Array(1024 - 9).fill(1));
    expect(peers[0]?.t.frames).toHaveLength(1);
    expect(host.t.errors()).toEqual(["frame_too_large"]);
    expect(host.client.closed).toBe(false);
    expect(h.metrics.framesDropped.too_large).toBe(1);
  });

  it("drops oversize control messages", async () => {
    const { h, host } = await room(0);
    await h.relay.handleText(
      host.client,
      JSON.stringify({ type: "ping", pad: "x".repeat(5000) })
    );
    expect(host.t.errors()).toEqual(["frame_too_large"]);
  });

  it("rate-limits messages per second and closes after repeated violations", async () => {
    const { h, host, peers } = await room(1, {
      MAX_MESSAGES_PER_SECOND: "10",
      RATE_LIMIT_STRIKES: "3",
    });
    // Bucket holds 2 s worth (20 messages).
    for (let i = 0; i < 25; i += 1) {
      host.frame(2, [i]);
    }
    expect(peers[0]?.t.frames).toHaveLength(20);
    expect(host.t.errors()).toEqual(["rate_limited"]);
    expect(h.metrics.framesDropped.rate_limited).toBe(5);

    // Refill: 1 s = 10 messages.
    h.advance(1000);
    for (let i = 0; i < 10; i += 1) {
      host.frame(2, [i]);
    }
    expect(peers[0]?.t.frames).toHaveLength(30);

    // Keep flooding over several seconds: strike 2, then strike 3 closes.
    host.frame(2, [0]);
    h.advance(1000);
    for (let i = 0; i < 30; i += 1) {
      host.frame(2, [i]);
    }
    expect(host.client.closed).toBe(true);
    expect(host.t.closed?.code).toBe(RELAY_CLOSE_CODES.rateLimited);
    expect(peers[0]?.t.of("room_closed")[0]?.reason).toBe("host_left");
  });

  it("rate-limits bytes per second", async () => {
    const { host, peers } = await room(1, {
      MAX_BYTES_PER_SECOND: "2048",
      MAX_FRAME_BYTES: "1024",
    });
    for (let i = 0; i < 6; i += 1) {
      host.frame(2, new Array(1014).fill(0));
    }
    // 4 KiB burst = 4 frames of 1024 bytes.
    expect(peers[0]?.t.frames).toHaveLength(4);
    expect(host.t.errors()).toEqual(["rate_limited"]);
  });

  it("backpressure: drops unreliable frames, closes a slow consumer on reliable ones", async () => {
    const { h, host, peer } = await room(2, { MAX_BUFFERED_BYTES: "1024" });
    const slow = peer(0);
    const fine = peer(1);
    slow.t.buffered = 4096;
    host.frame(0, [1], { mode: 0 });
    expect(slow.t.frames).toHaveLength(0);
    expect(fine.t.frames).toHaveLength(1);
    expect(slow.client.closed).toBe(false);
    expect(h.metrics.framesDropped.backpressure).toBe(1);

    host.frame(0, [2], { mode: 2 });
    expect(slow.t.closed?.code).toBe(RELAY_CLOSE_CODES.slowConsumer);
    expect(fine.t.frames).toHaveLength(2);
    expect(host.t.of("peer_left")[0]).toMatchObject({
      peerId: 2,
      reason: "disconnected",
    });
  });
});

describe("simulation", () => {
  it("delays frames by RELAY_SIM_LATENCY_MS", async () => {
    const { h, host, peers } = await room(1, { RELAY_SIM_LATENCY_MS: "100" });
    host.frame(2, [1]);
    expect(peers[0]?.t.frames).toHaveLength(0);
    h.advance(99);
    expect(peers[0]?.t.frames).toHaveLength(0);
    h.advance(1);
    expect(peers[0]?.t.frames).toHaveLength(1);
  });

  it("drops only unreliable frames with RELAY_SIM_LOSS", async () => {
    const { h, host, peers } = await room(1, { RELAY_SIM_LOSS: "50" });
    h.setRandom(0.2);
    host.frame(2, [1], { mode: 0 });
    host.frame(2, [2], { mode: 1 });
    host.frame(2, [3], { mode: 2 });
    expect(decoded(peers[0]?.t.frames ?? []).map((f) => f?.data)).toEqual([
      [3],
    ]);
    h.setRandom(0.7);
    host.frame(2, [4], { mode: 0 });
    expect(peers[0]?.t.frames).toHaveLength(2);
  });

  it("is ignored in production", async () => {
    const { loadConfig } = await import("../src/config.ts");
    const config = loadConfig(
      {
        NODE_ENV: "production",
        API_INTERNAL_URL: "http://api.test",
        RELAY_SIM_LATENCY_MS: "100",
      },
      ["--sim-loss=20"]
    );
    expect(config.RELAY_SIM_LATENCY_MS).toBe(0);
    expect(config.RELAY_SIM_LOSS).toBe(0);
    const dev = loadConfig({ API_INTERNAL_URL: "http://api.test" }, [
      "--sim-latency=80",
      "--sim-loss=5",
    ]);
    expect(dev.RELAY_SIM_LATENCY_MS).toBe(80);
    expect(dev.RELAY_SIM_LOSS).toBe(5);
  });
});
