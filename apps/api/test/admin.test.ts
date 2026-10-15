import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestContext, type TestContext } from "./helpers.ts";

describe("admin", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("login works with the right password only; player tokens are not admin tokens", async () => {
    const admin = await ctx.createAdmin("admin");
    const bad = await ctx.req("POST", "/admin/auth/login", {
      body: { email: admin.email, password: "wrong-password!" },
    });
    expect(bad.status).toBe(401);
    const unknown = await ctx.req("POST", "/admin/auth/login", {
      body: { email: "x@example.com", password: "whatever-123" },
    });
    expect(unknown.status).toBe(401);

    const me = await ctx.req("GET", "/admin/me", { token: admin.token });
    expect(me.json).toMatchObject({ email: admin.email, role: "admin" });

    const player = await ctx.login();
    expect(
      (await ctx.req("GET", "/admin/me", { token: player.token })).status
    ).toBe(401);
  });

  it("moderators can ban/flag but not disband, delete runs or manage admins", async () => {
    const mod = await ctx.createAdmin("moderator");
    const p = await ctx.login();
    const guild = (
      await ctx.req("POST", "/guilds", {
        token: p.token,
        body: { name: "Mod Test", tag: "MODT" },
      })
    ).json;
    const run = (await ctx.reportRun(p.token, { participants: [p.id] })).json;

    expect(
      (
        await ctx.req("POST", `/admin/runs/${run.id}/flag`, {
          token: mod.token,
          body: { reason: "Seltsam" },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await ctx.req("POST", `/admin/players/${p.id}/bans`, {
          token: mod.token,
          body: { reason: "Test", durationDays: 1 },
        })
      ).status
    ).toBe(201);
    expect(
      (
        await ctx.req("POST", `/admin/players/${p.id}/unban`, {
          token: mod.token,
        })
      ).status
    ).toBe(200);

    expect(
      (
        await ctx.req("POST", `/admin/guilds/${guild.id}/disband`, {
          token: mod.token,
        })
      ).status
    ).toBe(403);
    expect(
      (await ctx.req("DELETE", `/admin/runs/${run.id}`, { token: mod.token }))
        .status
    ).toBe(403);
    expect(
      (await ctx.req("GET", "/admin/admins", { token: mod.token })).status
    ).toBe(403);
    expect(
      (
        await ctx.req("POST", "/admin/admins", {
          token: mod.token,
          body: {
            email: "new@example.com",
            password: "long-enough-password",
            role: "admin",
          },
        })
      ).status
    ).toBe(403);
  });

  it("admins can disband guilds, delete runs and manage admin users; every write is audited", async () => {
    const admin = await ctx.createAdmin("admin");
    const p = await ctx.login();
    const m = await ctx.login();
    const guild = (
      await ctx.req("POST", "/guilds", {
        token: p.token,
        body: { name: "Doomed", tag: "DOOM" },
      })
    ).json;
    await ctx.req("POST", "/guilds/join", {
      token: m.token,
      body: { inviteCode: guild.inviteCode },
    });
    const run = (await ctx.reportRun(p.token, { participants: [p.id] })).json;

    const rename = await ctx.req("PATCH", `/admin/players/${p.id}`, {
      token: admin.token,
      body: { name: "Renamed" },
    });
    expect(rename.status).toBe(200);
    const renameGuild = await ctx.req("PATCH", `/admin/guilds/${guild.id}`, {
      token: admin.token,
      body: { name: "Doomed Two" },
    });
    expect(renameGuild.status).toBe(200);
    const reset = await ctx.req(
      "POST",
      `/admin/guilds/${guild.id}/invite-code`,
      { token: admin.token }
    );
    expect(reset.json.inviteCode).not.toBe(guild.inviteCode);
    const remove = await ctx.req(
      "DELETE",
      `/admin/guilds/${guild.id}/members/${m.id}`,
      { token: admin.token }
    );
    expect(remove.status).toBe(200);
    expect(
      (await ctx.req("DELETE", `/admin/runs/${run.id}`, { token: admin.token }))
        .status
    ).toBe(204);
    expect(
      (
        await ctx.req("POST", `/admin/guilds/${guild.id}/disband`, {
          token: admin.token,
        })
      ).status
    ).toBe(204);
    expect(
      (await ctx.req("GET", `/guilds/${guild.id}`, { token: p.token })).status
    ).toBe(403);

    const created = await ctx.req("POST", "/admin/admins", {
      token: admin.token,
      body: {
        email: "Mod2@Example.com",
        password: "long-enough-password",
        role: "moderator",
      },
    });
    expect(created.status).toBe(201);
    expect(created.json.email).toBe("mod2@example.com");
    const disabled = await ctx.req(
      "POST",
      `/admin/admins/${created.json.id}/disable`,
      { token: admin.token }
    );
    expect(disabled.json.disabledAt).not.toBeNull();
    const login = await ctx.req("POST", "/admin/auth/login", {
      body: { email: "mod2@example.com", password: "long-enough-password" },
    });
    expect(login.status).toBe(401);
    expect(
      (
        await ctx.req("POST", `/admin/admins/${admin.id}/disable`, {
          token: admin.token,
        })
      ).status
    ).toBe(400);

    const audit = await ctx.req(
      "GET",
      `/admin/audit?adminId=${admin.id}&limit=50`,
      { token: admin.token }
    );
    expect(audit.status).toBe(200);
    const actions = audit.json.items
      .map((e: { action: string }) => e.action)
      .sort();
    expect(actions).toEqual(
      [
        "admin.create",
        "admin.disable",
        "guild.disband",
        "guild.remove_member",
        "guild.rename",
        "guild.reset_invite_code",
        "player.rename",
        "run.delete",
      ].sort()
    );
    expect(
      audit.json.items.every(
        (e: { adminEmail: string }) => e.adminEmail === admin.email
      )
    ).toBe(true);
  });

  it("player search, detail and stats", async () => {
    const admin = await ctx.createAdmin("moderator");
    const p = await ctx.login("Suchbar");
    await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: admin.token,
      body: { reason: "Beleidigung", durationDays: null },
    });

    const search = await ctx.req("GET", "/admin/players?q=suchb", {
      token: admin.token,
    });
    expect(search.json.items).toEqual([
      expect.objectContaining({ id: p.id, banned: true }),
    ]);
    const byId = await ctx.req("GET", `/admin/players?q=${p.id}`, {
      token: admin.token,
    });
    expect(byId.json.total).toBe(1);

    const detail = await ctx.req("GET", `/admin/players/${p.id}`, {
      token: admin.token,
    });
    expect(detail.json.bans).toEqual([
      expect.objectContaining({
        reason: "Beleidigung",
        active: true,
        expiresAt: null,
        createdBy: admin.email,
      }),
    ]);

    const stats = await ctx.req("GET", "/admin/stats", { token: admin.token });
    expect(stats.json.activeBans).toBeGreaterThanOrEqual(1);
    expect(stats.json.players).toBeGreaterThanOrEqual(1);
  });
});
