import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RELAY_KEY_HEADER, RelayPlayerStatus } from "@soulwick/contracts";
import { createApp } from "../src/app.ts";
import { createTestContext, type TestContext, testConfig } from "./helpers.ts";

const RELAY_KEY = "test-relay-internal-key-0123456789abcdef";

describe("internal relay endpoint", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ RELAY_INTERNAL_KEY: RELAY_KEY });
  });
  afterAll(() => ctx.close());

  const status = (
    playerId: string,
    query = "",
    key: string | null = RELAY_KEY
  ) =>
    ctx.req("GET", `/internal/relay/players/${playerId}/status${query}`, {
      headers: key === null ? {} : { [RELAY_KEY_HEADER]: key },
    });

  it("returns name, ban and guild status of a player", async () => {
    const p = await ctx.login("Relayprobe");
    const res = await status(p.id);
    expect(res.status).toBe(200);
    expect(RelayPlayerStatus.parse(res.json)).toEqual({
      playerId: p.id,
      name: "Relayprobe",
      banned: false,
      guildId: null,
      guildMember: null,
      guildIds: [],
    });
  });

  it("checks guild membership for the queried guild", async () => {
    const founder = await ctx.login();
    const outsider = await ctx.login();
    const created = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Relay Guild", tag: "RLY" },
    });
    expect(created.status).toBe(201);
    const guildId = created.json.id as string;

    const member = await status(founder.id, `?guildId=${guildId}`);
    expect(member.json).toMatchObject({ guildId, guildMember: true });

    const other = await status(outsider.id, `?guildId=${guildId}`);
    expect(other.json).toMatchObject({ guildId: null, guildMember: false });

    const wrongGuild = await status(founder.id, `?guildId=${randomUUID()}`);
    expect(wrongGuild.json).toMatchObject({ guildId, guildMember: false });

    // D-147: every active guild is listed; `guildId` stays the oldest one.
    const second = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Relay Guild Two", tag: "RLY2" },
    });
    expect(second.status).toBe(201);
    const both = await status(founder.id, `?guildId=${second.json.id}`);
    expect(both.json).toMatchObject({
      guildId,
      guildMember: true,
      guildIds: [guildId, second.json.id],
    });

    const badQuery = await status(founder.id, "?guildId=not-a-uuid");
    expect(badQuery.status).toBe(400);
    expect(badQuery.json.error).toBe("validation_error");
  });

  it("reports active bans, but not expired or revoked ones", async () => {
    const banned = await ctx.login();
    const old = await ctx.login();
    await ctx.db.ban.create({
      data: { playerId: banned.id, reason: "test", expiresAt: null },
    });
    await ctx.db.ban.create({
      data: {
        playerId: old.id,
        reason: "expired",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect((await status(banned.id)).json.banned).toBe(true);
    expect((await status(old.id)).json.banned).toBe(false);
  });

  it("rejects missing or wrong keys and unknown players", async () => {
    const p = await ctx.login();
    const missing = await status(p.id, "", null);
    expect(missing.status).toBe(401);
    expect(missing.json.error).toBe("unauthorized");

    const wrong = await status(p.id, "", `${RELAY_KEY.slice(0, -1)}x`);
    expect(wrong.status).toBe(401);

    const unknown = await status(randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toBe("player_not_found");

    const invalid = await status("not-a-uuid");
    expect(invalid.status).toBe(404);
    expect(invalid.json.error).toBe("not_found");
  });

  it("is disabled without RELAY_INTERNAL_KEY", async () => {
    const app = createApp({ db: ctx.db, config: testConfig() });
    const p = await ctx.login();
    const res = await app.request(`/internal/relay/players/${p.id}/status`, {
      headers: { [RELAY_KEY_HEADER]: RELAY_KEY },
    });
    expect(res.status).toBe(404);
  });

  it("does not count keyed relay calls against the per-IP rate limit", async () => {
    const app = createApp({
      db: ctx.db,
      config: testConfig({
        RELAY_INTERNAL_KEY: RELAY_KEY,
        RATE_LIMIT_PER_MINUTE: "2",
      }),
    });
    const p = await ctx.login();
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request(`/internal/relay/players/${p.id}/status`, {
        headers: { [RELAY_KEY_HEADER]: RELAY_KEY },
      });
      expect(res.status).toBe(200);
    }
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      codes.push(
        (await app.request(`/internal/relay/players/${p.id}/status`)).status
      );
    }
    expect(codes).toEqual([401, 401, 429]);
  });
});
