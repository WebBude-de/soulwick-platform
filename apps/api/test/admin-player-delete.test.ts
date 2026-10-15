import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

describe("DELETE /admin/players/:id", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  /** Dev login with a known device id, so the test can check the identity afterwards. */
  async function loginWithDevice(name: string) {
    const deviceId = `device-${randomUUID()}`;
    const res = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name, deviceId },
    });
    expect(res.status).toBe(200);
    return {
      id: res.json.player.id as string,
      token: res.json.token as string,
      deviceId,
    };
  }

  it("deletes the account like DELETE /me: identities, membership, runs anonymised, audited", async () => {
    const admin = await ctx.createAdmin("admin");
    const founder = await loginWithDevice("Gruender");
    const officer = await ctx.login("Offizierin");
    const guild = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Loeschgilde", tag: "LOE1" },
    });
    expect(guild.status).toBe(201);
    const join = await ctx.req("POST", "/guilds/join", {
      token: officer.token,
      body: { inviteCode: guild.json.inviteCode },
    });
    expect(join.status).toBe(200);
    const run = await ctx.reportRun(founder.token, {
      mode: "quick",
      participants: [founder.id, officer.id],
    });
    expect(run.status).toBe(201);

    const res = await ctx.req("DELETE", `/admin/players/${founder.id}`, {
      token: admin.token,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      id: founder.id,
      name: "Gruender",
      guild: {
        id: guild.json.id,
        tag: "LOE1",
        disbanded: false,
        newFounderId: officer.id,
      },
      wasBanned: false,
    });

    expect(
      await ctx.db.player.findUnique({ where: { id: founder.id } })
    ).toBeNull();
    expect(
      await ctx.db.playerIdentity.count({
        where: { providerUserId: founder.deviceId },
      })
    ).toBe(0);
    // The run stays (guild boards) but no longer references the deleted player.
    const participants = await ctx.db.runPlayer.findMany({
      where: { runId: run.json.id },
      select: { playerId: true },
    });
    expect(participants).toEqual([{ playerId: officer.id }]);
    // Founder role passed on (P-102).
    const remaining = await ctx.db.guild.findUniqueOrThrow({
      where: { id: guild.json.id },
    });
    expect(remaining.founderId).toBe(officer.id);
    // The old token is useless now.
    expect((await ctx.req("GET", "/me", { token: founder.token })).status).toBe(
      401
    );

    const audit = await ctx.db.auditLog.findMany({
      where: { action: "player.delete", targetId: founder.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ adminId: admin.id, targetType: "player" });
    expect(audit[0]?.details).toEqual({
      name: "Gruender",
      guildId: guild.json.id,
      guildDisbanded: false,
    });
    // Never the raw identity ids.
    expect(JSON.stringify(audit[0]?.details)).not.toContain(founder.deviceId);

    // Deletion log (P-026): channel admin, no name, no id in clear.
    const log = await ctx.db.accountDeletion.findMany({
      where: { channel: "admin" },
    });
    expect(log).toHaveLength(1);
    expect(log[0]?.wasBanned).toBe(false);
    expect(JSON.stringify(log[0])).not.toContain("Gruender");
    expect(JSON.stringify(log[0])).not.toContain(founder.id);

    // Deleting again: the account is gone.
    const again = await ctx.req("DELETE", `/admin/players/${founder.id}`, {
      token: admin.token,
    });
    expect(again.status).toBe(404);
    expect(again.json.error).toBe("player_not_found");
  });

  it("is admin-only and validates the player and the body", async () => {
    const mod = await ctx.createAdmin("moderator");
    const admin = await ctx.createAdmin("admin");
    const p = await ctx.login("Bleibtda");

    const denied = await ctx.req("DELETE", `/admin/players/${p.id}`, {
      token: mod.token,
    });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toBe("forbidden");
    expect((await ctx.req("DELETE", `/admin/players/${p.id}`)).status).toBe(
      401
    );
    expect(
      (
        await ctx.req("DELETE", `/admin/players/${p.id}`, {
          token: p.token,
        })
      ).status
    ).toBe(401);

    const unknown = await ctx.req("DELETE", `/admin/players/${randomUUID()}`, {
      token: admin.token,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toBe("player_not_found");

    const invalid = await ctx.req("DELETE", `/admin/players/${p.id}`, {
      token: admin.token,
      body: { note: "x".repeat(501) },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error).toBe("validation_error");

    expect(await ctx.db.player.findUnique({ where: { id: p.id } })).not.toBe(
      null
    );
    expect(
      await ctx.db.auditLog.count({
        where: { action: "player.delete", targetId: p.id },
      })
    ).toBe(0);
  });

  it("keeps the admin's note in the audit entry; an old deletionRequestId is ignored", async () => {
    const admin = await ctx.createAdmin("admin");
    const p = await ctx.login("Notiert");
    const res = await ctx.req("DELETE", `/admin/players/${p.id}`, {
      token: admin.token,
      body: { note: "Per Support-Mail", deletionRequestId: randomUUID() },
    });
    expect(res.status).toBe(200);
    const audit = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: "player.delete", targetId: p.id },
    });
    expect(audit.details).toEqual({
      name: "Notiert",
      note: "Per Support-Mail",
    });
  });

  it("deletes banned players, who cannot use DELETE /me (P-108)", async () => {
    const mod = await ctx.createAdmin("moderator");
    const admin = await ctx.createAdmin("admin");
    const p = await ctx.login("Gesperrter");
    const ban = await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Testsperre", durationDays: null },
    });
    expect(ban.status).toBe(201);

    const self = await ctx.req("DELETE", "/me", { token: p.token });
    expect(self.status).toBe(403);
    expect(self.json.error).toBe("banned");

    const before = await ctx.db.accountDeletion.count({
      where: { channel: "admin", wasBanned: true },
    });
    const res = await ctx.req("DELETE", `/admin/players/${p.id}`, {
      token: admin.token,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: p.id,
      name: "Gesperrter",
      guild: null,
      wasBanned: true,
    });
    expect(
      await ctx.db.accountDeletion.count({
        where: { channel: "admin", wasBanned: true },
      })
    ).toBe(before + 1);
    expect(await ctx.db.player.findUnique({ where: { id: p.id } })).toBeNull();
    // Bans go with the account (ON DELETE CASCADE).
    expect(await ctx.db.ban.count({ where: { playerId: p.id } })).toBe(0);
  });

  it("disbands the guild when the deleted player was its last member", async () => {
    const admin = await ctx.createAdmin("admin");
    const p = await ctx.login("Einsam");
    const guild = await ctx.req("POST", "/guilds", {
      token: p.token,
      body: { name: "Einzelgilde", tag: "LOE2" },
    });
    const res = await ctx.req("DELETE", `/admin/players/${p.id}`, {
      token: admin.token,
    });
    expect(res.status).toBe(200);
    expect(res.json.guild).toEqual({
      id: guild.json.id,
      tag: "LOE2",
      disbanded: true,
      newFounderId: null,
    });
    const row = await ctx.db.guild.findUniqueOrThrow({
      where: { id: guild.json.id },
    });
    expect(row.disbandedAt).not.toBeNull();
  });
});
