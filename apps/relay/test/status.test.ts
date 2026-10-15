import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApiStatusSource } from "../src/auth.ts";
import { RELAY_KEY, startFakeApi } from "./fake-api.ts";
import { silentLogger } from "./helpers.ts";

describe("API status source", () => {
  let api: ReturnType<typeof startFakeApi>;
  beforeAll(() => {
    api = startFakeApi();
  });
  afterAll(() => api.stop());

  const source = (
    opts: { key?: string; url?: string; now?: () => number } = {}
  ) =>
    createApiStatusSource({
      apiUrl: opts.url ?? api.url,
      key: opts.key ?? RELAY_KEY,
      cacheMs: 30_000,
      timeoutMs: 300,
      logger: silentLogger,
      now: opts.now,
    });

  it("returns the status and caches it", async () => {
    let clock = 0;
    const s = source({ now: () => clock });
    const p = api.add("Cached", { guildId: randomUUID() });
    const before = api.state.calls;
    const [first, second] = await Promise.all([
      s.get(p.playerId),
      s.get(p.playerId),
    ]);
    expect(first).toEqual({ kind: "ok", status: p });
    expect(second).toEqual(first);
    expect(await s.get(p.playerId)).toEqual(first);
    expect(api.state.calls - before).toBe(1);

    clock = 30_001;
    await s.get(p.playerId);
    expect(api.state.calls - before).toBe(2);
  });

  it("maps unknown players to not_found", async () => {
    expect(await source().get(randomUUID())).toEqual({ kind: "not_found" });
  });

  it("is unavailable with a wrong key, on server errors, timeouts and without config", async () => {
    const p = api.add("Down");
    expect(await source({ key: "wrong-key" }).get(p.playerId)).toEqual({
      kind: "unavailable",
    });

    api.state.failWith = 503;
    const s = source();
    expect(await s.get(p.playerId)).toEqual({ kind: "unavailable" });
    api.state.failWith = 0;
    // Failures are not cached.
    expect((await s.get(p.playerId)).kind).toBe("ok");

    api.state.delayMs = 1000;
    expect(await source().get(p.playerId)).toEqual({ kind: "unavailable" });
    api.state.delayMs = 0;

    expect(await source({ url: "" }).get(p.playerId)).toEqual({
      kind: "unavailable",
    });
    expect(await source({ url: "http://127.0.0.1:9" }).get(p.playerId)).toEqual(
      { kind: "unavailable" }
    );
  });
});
