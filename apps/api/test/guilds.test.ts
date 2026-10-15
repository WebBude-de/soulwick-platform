import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MAX_GUILD_MEMBERS } from "@soulwick/contracts";
import { createTestContext, type TestContext } from "./helpers.ts";

const TAG_PATTERN = /^[A-Z0-9]+$/;

let tagCounter = 0;
const nextTag = () => {
  const tag = `T${tagCounter.toString(36).toUpperCase().padStart(3, "0")}`;
  tagCounter += 1;
  return tag;
};

describe("guilds", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  async function createGuild(token: string, name = `Guild ${nextTag()}`) {
    const res = await ctx.req("POST", "/guilds", {
      token,
      body: { name, tag: nextTag().toLowerCase() },
    });
    expect(res.status).toBe(201);
    return res.json;
  }

  it("creates a guild with the founder as member and empty progress", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    expect(guild.tag).toMatch(TAG_PATTERN);
    expect(guild.members).toEqual([
      expect.objectContaining({ playerId: founder.id, role: "founder" }),
    ]);
    expect(guild.progress).toEqual({
      treasury: 0,
      forgeLevels: {},
      version: 0,
    });
    const me = await ctx.req("GET", "/me", { token: founder.token });
    expect(me.json.guild).toMatchObject({ id: guild.id, role: "founder" });
  });

  it("allows at most one guild per player", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const second = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Another", tag: nextTag() },
    });
    expect(second.status).toBe(409);
    expect(second.json.error).toBe("already_in_guild");

    const other = await ctx.login();
    const otherGuild = await createGuild(other.token);
    const join = await ctx.req("POST", "/guilds/join", {
      token: founder.token,
      body: { inviteCode: otherGuild.inviteCode },
    });
    expect(join.status).toBe(409);
    expect(join.json.error).toBe("already_in_guild");
    expect(guild.id).not.toBe(otherGuild.id);
  });

  it("rejects duplicate names/tags among active guilds", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    const g = await createGuild(a.token, "Unique Name");
    const res = await ctx.req("POST", "/guilds", {
      token: b.token,
      body: { name: "unique name", tag: "zz9" },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("guild_name_taken");
    const res2 = await ctx.req("POST", "/guilds", {
      token: b.token,
      body: { name: "Else", tag: g.tag },
    });
    expect(res2.json.error).toBe("guild_tag_taken");
  });

  it(`caps guilds at ${MAX_GUILD_MEMBERS} members`, async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    for (let i = 1; i < MAX_GUILD_MEMBERS; i += 1) {
      const p = await ctx.login();
      const res = await ctx.req("POST", "/guilds/join", {
        token: p.token,
        body: { inviteCode: guild.inviteCode },
      });
      expect(res.status).toBe(200);
    }
    const late = await ctx.login();
    const full = await ctx.req("POST", "/guilds/join", {
      token: late.token,
      body: { inviteCode: guild.inviteCode.toLowerCase() },
    });
    expect(full.status).toBe(409);
    expect(full.json.error).toBe("guild_full");
  });

  it("founder can kick and rotate the code; members cannot; members can leave", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const m1 = await ctx.login();
    const m2 = await ctx.login();
    for (const m of [m1, m2]) {
      await ctx.req("POST", "/guilds/join", {
        token: m.token,
        body: { inviteCode: guild.inviteCode },
      });
    }

    const memberKick = await ctx.req("DELETE", `/guilds/me/members/${m2.id}`, {
      token: m1.token,
    });
    expect(memberKick.status).toBe(403);
    const memberRotate = await ctx.req("POST", "/guilds/me/invite-code", {
      token: m1.token,
    });
    expect(memberRotate.status).toBe(403);

    const kick = await ctx.req("DELETE", `/guilds/me/members/${m2.id}`, {
      token: founder.token,
    });
    expect(kick.status).toBe(200);
    expect(
      kick.json.members.map((m: { playerId: string }) => m.playerId)
    ).not.toContain(m2.id);
    expect(
      (await ctx.req("GET", "/guilds/me", { token: m2.token })).status
    ).toBe(404);

    const rotate = await ctx.req("POST", "/guilds/me/invite-code", {
      token: founder.token,
    });
    expect(rotate.status).toBe(200);
    expect(rotate.json.inviteCode).not.toBe(guild.inviteCode);
    const oldCode = await ctx.req("POST", "/guilds/join", {
      token: m2.token,
      body: { inviteCode: guild.inviteCode },
    });
    expect(oldCode.status).toBe(404);

    const leave = await ctx.req("POST", "/guilds/leave", { token: m1.token });
    expect(leave.status).toBe(204);
    expect(
      (await ctx.req("GET", "/guilds/me", { token: m1.token })).json.error
    ).toBe("not_in_guild");
  });

  it("founder leaving passes the founder role on; last member leaving disbands", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const m = await ctx.login();
    await ctx.req("POST", "/guilds/join", {
      token: m.token,
      body: { inviteCode: guild.inviteCode },
    });

    expect(
      (await ctx.req("POST", "/guilds/leave", { token: founder.token })).status
    ).toBe(204);
    const after = await ctx.req("GET", "/guilds/me", { token: m.token });
    expect(after.json.founderId).toBe(m.id);
    expect(after.json.members[0]).toMatchObject({
      playerId: m.id,
      role: "founder",
    });

    expect(
      (await ctx.req("POST", "/guilds/leave", { token: m.token })).status
    ).toBe(204);
    const pub = await ctx.req("GET", `/public/guilds/${guild.tag}`);
    expect(pub.status).toBe(404);
  });

  it("progress uses an optimistic version check (no double spending)", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const m = await ctx.login();
    await ctx.req("POST", "/guilds/join", {
      token: m.token,
      body: { inviteCode: guild.inviteCode },
    });

    const deposit = await ctx.req("PATCH", "/guilds/me/progress", {
      token: founder.token,
      body: { version: 0, treasury: 500 },
    });
    expect(deposit.status).toBe(200);
    expect(deposit.json).toEqual({
      treasury: 500,
      forgeLevels: {},
      version: 1,
    });

    // Both members read version 1 and try to spend the same gold.
    const buyA = await ctx.req("PATCH", "/guilds/me/progress", {
      token: founder.token,
      body: { version: 1, treasury: 200, forgeLevels: { max_hp: 1 } },
    });
    const buyB = await ctx.req("PATCH", "/guilds/me/progress", {
      token: m.token,
      body: { version: 1, treasury: 100, forgeLevels: { damage: 1 } },
    });
    expect(buyA.status).toBe(200);
    expect(buyB.status).toBe(409);
    expect(buyB.json).toEqual({
      error: "version_conflict",
      current: { treasury: 200, forgeLevels: { max_hp: 1 }, version: 2 },
    });

    const negative = await ctx.req("PATCH", "/guilds/me/progress", {
      token: m.token,
      body: { version: 2, treasury: -1 },
    });
    expect(negative.status).toBe(400);
  });

  it("public guild page shows name, member count and best run without invite code", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token, "Public Guild");
    await ctx.reportRun(founder.token, {
      mode: "guild",
      guildId: guild.id,
      participants: [founder.id],
      roomReached: 12,
      durationSeconds: 900,
    });
    const pub = await ctx.req(
      "GET",
      `/public/guilds/${guild.tag.toLowerCase()}`
    );
    expect(pub.status).toBe(200);
    expect(pub.json).toMatchObject({
      name: "Public Guild",
      tag: guild.tag,
      memberCount: 1,
    });
    expect(pub.json.bestRun).toMatchObject({
      roomReached: 12,
      durationSeconds: 900,
    });
    expect(pub.json.inviteCode).toBeUndefined();
  });
});
