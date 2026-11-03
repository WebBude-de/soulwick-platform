import { describe, expect, it } from "bun:test";
import type { Logger } from "../src/logger.ts";
import { Metrics } from "../src/metrics.ts";
import { Relay } from "../src/relay.ts";
import {
  FakeStatusSource,
  FakeTransport,
  playerToken,
  silentLogger,
  testConfig,
} from "./helpers.ts";
import { testTokenVerifier } from "./jwt.ts";

interface Line {
  fields: Record<string, unknown>;
  level: string;
  msg: string;
}

function loggedRelay() {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (msg: string, fields: Record<string, unknown> = {}) =>
      lines.push({ level, msg, fields });
  const logger: Logger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
  const status = new FakeStatusSource();
  const relay = new Relay(testConfig(), {
    logger,
    metrics: new Metrics(0),
    status,
    tokens: testTokenVerifier(silentLogger),
    now: () => 1_000_000,
  });
  return { lines, relay, status };
}

describe("relay log levels", () => {
  it("logs control message types on debug, never their contents", async () => {
    const r = loggedRelay();
    const s = r.status.add("Host");
    const token = await playerToken(s.playerId);
    const client = r.relay.open(new FakeTransport());
    await r.relay.handleText(
      client,
      JSON.stringify({
        type: "hello",
        token,
        protocolVersion: testConfig().PROTOCOL_VERSION,
        gameVersion: "1.0.0",
        platform: "windows",
      })
    );
    await r.relay.handleText(
      client,
      JSON.stringify({ type: "create", mode: "quick" })
    );
    const debug = r.lines.filter((l) => l.level === "debug");
    expect(debug.map((l) => [l.msg, l.fields.type])).toEqual([
      ["message", "hello"],
      ["message", "create"],
    ]);
    expect(JSON.stringify(r.lines)).not.toContain(token);
  });

  it("refused connections are warn, plain client errors stay info", async () => {
    const r = loggedRelay();
    const client = r.relay.open(new FakeTransport());
    await r.relay.handleText(
      client,
      JSON.stringify({
        type: "hello",
        token: "not-a-token",
        protocolVersion: testConfig().PROTOCOL_VERSION,
        gameVersion: "1.0.0",
        platform: "windows",
      })
    );
    const refused = r.lines.find((l) => l.msg === "client_error");
    expect(refused?.level).toBe("warn");
    expect(refused?.fields.code).toBe("unauthorized");

    const s = r.status.add("Guest");
    const ok = r.relay.open(new FakeTransport());
    await r.relay.handleText(
      ok,
      JSON.stringify({
        type: "hello",
        token: await playerToken(s.playerId),
        protocolVersion: testConfig().PROTOCOL_VERSION,
        gameVersion: "1.0.0",
        platform: "windows",
      })
    );
    await r.relay.handleText(
      ok,
      JSON.stringify({ type: "join", code: "ZZZZ" })
    );
    const joinError = r.lines.filter((l) => l.msg === "client_error").at(-1);
    expect(joinError?.fields.request).toBe("join");
    expect(joinError?.level).toBe("info");
  });
});
