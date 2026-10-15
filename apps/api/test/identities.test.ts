import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { isUniqueViolation } from "../src/lib/errors.ts";
import { loginWithIdentity } from "../src/services/identities.ts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

describe("player identities (P-014)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("dev login creates exactly one device identity and reuses it", async () => {
    const deviceId = randomUUID();
    const first = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name: "Docht", deviceId },
    });
    expect(first.status).toBe(200);
    const playerId = first.json.player.id as string;
    const before = await ctx.db.playerIdentity.findMany({
      where: { playerId },
    });
    expect(before).toEqual([
      expect.objectContaining({ provider: "device", providerUserId: deviceId }),
    ]);

    const second = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name: "Other", deviceId },
    });
    expect(second.json.player.id).toBe(playerId);
    const after = await ctx.db.playerIdentity.findMany({ where: { playerId } });
    expect(after).toHaveLength(1);
    expect(after[0]?.lastUsedAt.getTime()).toBeGreaterThanOrEqual(
      before[0]?.lastUsedAt.getTime() ?? Number.POSITIVE_INFINITY
    );
  });

  it("one player with two identities is found via both; steamId and hasDeviceId derive from them", async () => {
    const p = await ctx.login("Zwei");
    const steamId = "76561198000000001";
    await ctx.db.playerIdentity.create({
      data: { playerId: p.id, provider: "steam", providerUserId: steamId },
    });

    const viaSteam = await loginWithIdentity(ctx.db, {
      provider: "steam",
      providerUserId: steamId,
      name: "ignored",
      now: new Date(),
    });
    expect(viaSteam.created).toBe(false);
    expect(viaSteam.player.id).toBe(p.id);
    expect(viaSteam.player.name).toBe("Zwei");
    expect(
      await ctx.db.playerIdentity.count({ where: { playerId: p.id } })
    ).toBe(2);

    const me = await ctx.req("GET", "/me", { token: p.token });
    expect(me.json.steamId).toBe(steamId);

    const admin = await ctx.createAdmin("moderator");
    const detail = await ctx.req("GET", `/admin/players/${p.id}`, {
      token: admin.token,
    });
    expect(detail.json).toMatchObject({ steamId, hasDeviceId: true });
    const search = await ctx.req("GET", `/admin/players?q=${steamId}`, {
      token: admin.token,
    });
    expect(search.json.items.map((i: { id: string }) => i.id)).toEqual([p.id]);
  });

  it("a new steam identity creates a new player; the same provider id cannot belong to two players", async () => {
    const steamId = "76561198000000002";
    const created = await loginWithIdentity(ctx.db, {
      provider: "steam",
      providerUserId: steamId,
      name: "Neu",
      now: new Date(),
    });
    expect(created.created).toBe(true);
    const other = await ctx.login();
    let rejected: unknown = null;
    try {
      await ctx.db.playerIdentity.create({
        data: {
          playerId: other.id,
          provider: "steam",
          providerUserId: steamId,
        },
      });
    } catch (err) {
      rejected = err;
    }
    expect(isUniqueViolation(rejected)).toBe(true);
  });

  it("DELETE /me removes the identities together with the player", async () => {
    const p = await ctx.login();
    const steamId = "76561198000000003";
    await ctx.db.playerIdentity.create({
      data: { playerId: p.id, provider: "steam", providerUserId: steamId },
    });
    expect((await ctx.req("DELETE", "/me", { token: p.token })).status).toBe(
      204
    );
    expect(
      await ctx.db.playerIdentity.count({ where: { playerId: p.id } })
    ).toBe(0);
    expect(
      await ctx.db.playerIdentity.count({ where: { providerUserId: steamId } })
    ).toBe(0);
  });
});
