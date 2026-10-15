import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { API_VERSION } from "@soulwick/contracts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

describe("auth, /me and bans", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("GET /health reports ok", async () => {
    const res = await ctx.req("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      status: "ok",
      db: "ok",
      apiVersion: API_VERSION,
    });
  });

  it("dev auth issues a token and reuses the account for the same device", async () => {
    const deviceId = randomUUID();
    const first = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name: "Alice", deviceId },
    });
    expect(first.status).toBe(200);
    expect(first.json.player).toMatchObject({
      name: "Alice",
      guild: null,
      steamId: null,
    });

    const second = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name: "Other name", deviceId },
    });
    expect(second.json.player.id).toBe(first.json.player.id);
    expect(second.json.player.name).toBe("Alice");

    const me = await ctx.req("GET", "/me", { token: first.json.token });
    expect(me.status).toBe(200);
    expect(me.json.id).toBe(first.json.player.id);
  });

  it("dev auth rejects a wrong key and validates the body", async () => {
    const wrong = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": "nope" },
      body: { name: "Bob", deviceId: randomUUID() },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toBe("invalid_dev_auth_key");

    const invalid = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name: "B", deviceId: "short" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error).toBe("validation_error");
  });

  it("dev auth is off when DEV_AUTH_ENABLED=false", async () => {
    const off = await createTestContext({ DEV_AUTH_ENABLED: "false" });
    try {
      const res = await off.req("POST", "/auth/dev", {
        headers: { "x-dev-auth-key": DEV_KEY },
        body: { name: "Bob", deviceId: randomUUID() },
      });
      expect(res.status).toBe(403);
      expect(res.json.error).toBe("dev_auth_disabled");
    } finally {
      await off.close();
    }
  });

  it("steam auth answers 501 provider_not_configured until configured", async () => {
    const res = await ctx.req("POST", "/auth/steam", {
      body: { ticket: "00ff".repeat(10) },
    });
    expect(res.status).toBe(501);
    expect(res.json.error).toBe("provider_not_configured");
  });

  it("rejects missing, invalid and admin tokens on player routes", async () => {
    expect((await ctx.req("GET", "/me")).status).toBe(401);
    expect((await ctx.req("GET", "/me", { token: "garbage" })).status).toBe(
      401
    );
    const admin = await ctx.createAdmin("moderator");
    expect((await ctx.req("GET", "/me", { token: admin.token })).status).toBe(
      401
    );
  });

  it("an active ban blocks every authenticated route and login; unban restores access", async () => {
    const player = await ctx.login();
    const mod = await ctx.createAdmin("moderator");

    const ban = await ctx.req("POST", `/admin/players/${player.id}/bans`, {
      token: mod.token,
      body: { reason: "Cheating", durationDays: 7 },
    });
    expect(ban.status).toBe(201);

    for (const [method, path] of [
      ["GET", "/me"],
      ["GET", "/me/guilds"],
      ["POST", "/guilds/00000000-0000-4000-8000-000000000000/leave"],
      ["DELETE", "/me"],
    ] as const) {
      const res = await ctx.req(method, path, { token: player.token });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error).toBe("banned");
      expect(res.json.reason).toBe("Cheating");
      expect(typeof res.json.expiresAt).toBe("string");
    }

    const unban = await ctx.req("POST", `/admin/players/${player.id}/unban`, {
      token: mod.token,
    });
    expect(unban.status).toBe(200);
    expect((await ctx.req("GET", "/me", { token: player.token })).status).toBe(
      200
    );
  });

  it("DELETE /me removes the player and their run participation", async () => {
    const p = await ctx.login();
    const run = await ctx.reportRun(p.token, { participants: [p.id] });
    expect(run.status).toBe(201);
    const del = await ctx.req("DELETE", "/me", { token: p.token });
    expect(del.status).toBe(204);
    expect((await ctx.req("GET", "/me", { token: p.token })).status).toBe(401);
    const rows = await ctx.client.query(
      "select count(*)::int as n from run_players where player_id = $1",
      [p.id]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});
