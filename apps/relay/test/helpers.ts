import { randomUUID } from "node:crypto";
import {
  type ClientPlatform,
  encodeRelayFrame,
  type RelayPlayerStatus,
  type RelayServerMessage,
} from "@soulwick/contracts";
import type { PlayerStatusResult, PlayerStatusSource } from "../src/auth.ts";
import { type Config, loadConfig } from "../src/config.ts";
import type { Logger } from "../src/logger.ts";
import { Metrics } from "../src/metrics.ts";
import { type Client, Relay, type Transport } from "../src/relay.ts";
import { signPlayerJwt, type TestKey, testTokenVerifier } from "./jwt.ts";

export const GAME_VERSION = "1.0.0";

export const silentLogger: Logger = {
  info: () => undefined,
  error: () => undefined,
};

export const testConfig = (overrides: Record<string, string> = {}): Config =>
  loadConfig({
    NODE_ENV: "test",
    // Only for the defaults; tests inject the token check and the status source.
    API_INTERNAL_URL: "http://api.test",
    LOG_LEVEL: "silent",
    RELAY_PORT: "0",
    RELAY_HOST: "127.0.0.1",
    TRUST_PROXY: "false",
    ...overrides,
  });

/** Player JWT as GET /auth/token of the API issues it (P-027), signed with the test key. */
export function playerToken(
  playerId: string,
  opts: { key?: TestKey; expiresIn?: number; audience?: string } = {}
): Promise<string> {
  return signPlayerJwt(playerId, opts);
}

/** Status source backed by a map: missing = not_found, "down" = unavailable. */
export class FakeStatusSource implements PlayerStatusSource {
  readonly players = new Map<string, RelayPlayerStatus>();
  down: boolean;
  calls = 0;
  readonly forgotten: string[] = [];
  /** Stale answers, as a caching source would return them until `forget`. */
  readonly cached = new Map<string, RelayPlayerStatus>();

  constructor() {
    this.down = false;
  }

  forget(playerId: string) {
    this.forgotten.push(playerId);
    this.cached.delete(playerId);
  }

  add(name: string, extra: Partial<RelayPlayerStatus> = {}): RelayPlayerStatus {
    const status: RelayPlayerStatus = {
      playerId: randomUUID(),
      name,
      banned: false,
      guildId: null,
      guildMember: null,
      ...extra,
    };
    this.players.set(status.playerId, status);
    return status;
  }

  get(playerId: string): Promise<PlayerStatusResult> {
    this.calls += 1;
    if (this.down) {
      return Promise.resolve({ kind: "unavailable" });
    }
    const status = this.cached.get(playerId) ?? this.players.get(playerId);
    return Promise.resolve(
      status ? { kind: "ok", status } : { kind: "not_found" }
    );
  }
}

export class FakeTransport implements Transport {
  readonly ip = "127.0.0.1";
  readonly messages: RelayServerMessage[] = [];
  readonly frames: Uint8Array[] = [];
  closed: { code: number; reason: string } | null = null;
  buffered = 0;
  pings = 0;

  bufferedAmount() {
    return this.buffered;
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  ping() {
    this.pings += 1;
  }
  sendBinary(bytes: Uint8Array) {
    this.frames.push(bytes);
  }
  sendText(text: string) {
    this.messages.push(JSON.parse(text) as RelayServerMessage);
  }

  /** Messages of one type, in order. */
  of<T extends RelayServerMessage["type"]>(
    type: T
  ): Extract<RelayServerMessage, { type: T }>[] {
    return this.messages.filter(
      (m): m is Extract<RelayServerMessage, { type: T }> => m.type === type
    );
  }

  last(): RelayServerMessage | undefined {
    return this.messages.at(-1);
  }

  errors(): string[] {
    return this.of("error").map((e) => e.code);
  }

  clear() {
    this.messages.length = 0;
    this.frames.length = 0;
  }
}

/** Runs async steps one after another (order matters: peer ids, rate limits). */
export function inOrder<T, R>(
  items: readonly T[],
  step: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    (acc, item, i) =>
      acc.then(async (results) => [...results, await step(item, i)]),
    Promise.resolve([])
  );
}

export interface Peer {
  client: Client;
  frame: (
    to: number,
    data: number[],
    opts?: { mode?: number; channel?: number; from?: number }
  ) => void;
  /** Sends a control message and waits until it was handled. */
  send: (message: Record<string, unknown>) => Promise<void>;
  status: RelayPlayerStatus;
  t: FakeTransport;
}

/** A relay with a fake clock, fake transports and a fake status source. */
export function createHarness(
  overrides: Record<string, string> = {},
  /** Wall clock of the token check (ms); the relay's own clock is the fake `clock` below. */
  harnessOpts: { tokenNow?: () => number } = {}
) {
  const config = testConfig(overrides);
  let clock = 1_000_000;
  const status = new FakeStatusSource();
  const metrics = new Metrics(clock);
  const scheduled: { at: number; fn: () => void }[] = [];
  let randomValue = 0.5;
  const relay = new Relay(config, {
    logger: silentLogger,
    metrics,
    status,
    tokens: testTokenVerifier(silentLogger, { now: harnessOpts.tokenNow }),
    now: () => clock,
    random: () => randomValue,
    schedule: (fn, ms) => {
      scheduled.push({ at: clock + ms, fn });
    },
  });

  function connect(): Omit<Peer, "status"> {
    const t = new FakeTransport();
    const client = relay.open(t);
    return {
      client,
      t,
      send: (message) => relay.handleText(client, JSON.stringify(message)),
      frame: (to, data, opts = {}) =>
        relay.handleBinary(
          client,
          encodeRelayFrame({
            from: opts.from ?? 0,
            to,
            channel: opts.channel ?? 0,
            mode: opts.mode ?? 2,
            data: Uint8Array.from(data),
          })
        ),
    };
  }

  /** Connected and greeted player. */
  async function player(
    name: string,
    opts: {
      gameVersion?: string;
      platform?: ClientPlatform;
      status?: Partial<RelayPlayerStatus>;
    } = {}
  ): Promise<Peer> {
    const s = status.add(name, opts.status);
    const peer = connect();
    await peer.send({
      type: "hello",
      token: await playerToken(s.playerId),
      protocolVersion: config.PROTOCOL_VERSION,
      gameVersion: opts.gameVersion ?? GAME_VERSION,
      platform: opts.platform ?? "windows",
    });
    if (peer.t.last()?.type !== "welcome") {
      throw new Error(`hello failed: ${JSON.stringify(peer.t.messages)}`);
    }
    peer.t.clear();
    return { ...peer, status: s };
  }

  /** Host with a fresh quick room; returns the room code. */
  async function host(
    name = "Host",
    mode: Record<string, unknown> = { mode: "quick" }
  ) {
    const peer = await player(name);
    await peer.send({ type: "create", ...mode });
    const created = peer.t.of("created")[0];
    if (!created) {
      throw new Error(`create failed: ${JSON.stringify(peer.t.messages)}`);
    }
    peer.t.clear();
    return { ...peer, code: created.code };
  }

  return {
    config,
    relay,
    status,
    metrics,
    connect,
    player,
    host,
    advance(ms: number) {
      clock += ms;
      for (const job of scheduled.splice(0).sort((a, b) => a.at - b.at)) {
        if (job.at <= clock) {
          job.fn();
        } else {
          scheduled.push(job);
        }
      }
    },
    setRandom(value: number) {
      randomValue = value;
    },
    now: () => clock,
  };
}
