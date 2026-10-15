import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  GuildDetail,
  MAX_GUILD_MEMBERS,
  MAX_GUILDS_PER_PLAYER,
  MyGuildList,
} from "@soulwick/contracts";
import { createTestContext, type TestContext } from "./helpers.ts";

const TAG_PATTERN = /^[A-Z0-9]+$/;

let tagCounter = 0;
const nextTag = () => {
  const tag = `T${tagCounter.toString(36).toUpperCase().padStart(3, "0")}`;
  tagCounter += 1;
  return tag;
};

type Login = Awaited<ReturnType<TestContext["login"]>>;

describe("guilds (D-147)", () => {
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
    return GuildDetail.parse(res.json);
  }

  async function join(p: Login, inviteCode: string) {
    const res = await ctx.req("POST", "/guilds/join", {
      token: p.token,
      body: { inviteCode },
    });
    expect(res.status).toBe(200);
    return GuildDetail.parse(res.json);
  }

  /** Founder, officer and two members in one guild. */
  async function guildWithRoles() {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const officer = await ctx.login();
    const m1 = await ctx.login();
    const m2 = await ctx.login();
    for (const p of [officer, m1, m2]) {
      await join(p, guild.inviteCode as string);
    }
    const promote = await ctx.req(
      "PATCH",
      `/guilds/${guild.id}/members/${officer.id}`,
      { token: founder.token, body: { role: "officer" } }
    );
    expect(promote.status).toBe(200);
    return { guild, founder, officer, m1, m2 };
  }

  it("creates a guild with the founder as member and empty progress", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    expect(guild.tag).toMatch(TAG_PATTERN);
    expect(guild.myRole).toBe("founder");
    expect(guild.inviteCode).not.toBeNull();
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
    expect(me.json.guilds).toEqual([
      { id: guild.id, name: guild.name, tag: guild.tag, role: "founder" },
    ]);

    const list = await ctx.req("GET", "/me/guilds", { token: founder.token });
    expect(list.status).toBe(200);
    expect(MyGuildList.parse(list.json)).toEqual({
      maxGuilds: MAX_GUILDS_PER_PLAYER,
      items: [
        {
          id: guild.id,
          name: guild.name,
          tag: guild.tag,
          myRole: "founder",
          memberCount: 1,
          maxMembers: MAX_GUILD_MEMBERS,
          joinedAt: expect.any(String),
          treasury: 0,
        },
      ],
    });
  });

  it(`allows up to ${MAX_GUILDS_PER_PLAYER} guilds per player`, async () => {
    const p = await ctx.login();
    const own: string[] = [];
    for (let i = 0; i < MAX_GUILDS_PER_PLAYER - 1; i += 1) {
      own.push((await createGuild(p.token)).id);
    }
    const other = await ctx.login();
    const otherGuild = await createGuild(other.token);
    const joined = await join(p, otherGuild.inviteCode as string);
    expect(joined.myRole).toBe("member");
    expect(joined.inviteCode).toBeNull();
    own.push(otherGuild.id);

    const list = await ctx.req("GET", "/me/guilds", { token: p.token });
    expect(list.json.items.map((g: { id: string }) => g.id)).toEqual(own);
    expect(list.json.items.at(-1)).toMatchObject({
      myRole: "member",
      memberCount: 2,
    });

    const tooMany = await ctx.req("POST", "/guilds", {
      token: p.token,
      body: { name: "One Too Many", tag: nextTag() },
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.json.error).toBe("guild_limit_reached");

    const third = await createGuild((await ctx.login()).token);
    const joinTooMany = await ctx.req("POST", "/guilds/join", {
      token: p.token,
      body: { inviteCode: third.inviteCode },
    });
    expect(joinTooMany.status).toBe(409);
    expect(joinTooMany.json.error).toBe("guild_limit_reached");

    // Leaving frees a slot again.
    const left = await ctx.req("POST", `/guilds/${otherGuild.id}/leave`, {
      token: p.token,
    });
    expect(left.status).toBe(200);
    await join(p, third.inviteCode as string);
  });

  it("rejects joining twice and unknown invite codes", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const again = await ctx.req("POST", "/guilds/join", {
      token: founder.token,
      body: { inviteCode: guild.inviteCode },
    });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("already_member");

    const unknown = await ctx.req("POST", "/guilds/join", {
      token: founder.token,
      body: { inviteCode: "NOPE2345" },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toBe("invalid_invite_code");
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
    // The failed attempts do not count towards the guild limit.
    const list = await ctx.req("GET", "/me/guilds", { token: b.token });
    expect(list.json.items).toEqual([]);
  });

  it(`caps guilds at ${MAX_GUILD_MEMBERS} members`, async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    for (let i = 1; i < MAX_GUILD_MEMBERS; i += 1) {
      await join(await ctx.login(), guild.inviteCode as string);
    }
    const late = await ctx.login();
    const full = await ctx.req("POST", "/guilds/join", {
      token: late.token,
      body: { inviteCode: (guild.inviteCode as string).toLowerCase() },
    });
    expect(full.status).toBe(409);
    expect(full.json.error).toBe("guild_full");
  });

  it("only members can read a guild; the invite code only founder and officers", async () => {
    const { guild, founder, officer, m1 } = await guildWithRoles();
    const outsider = await ctx.login();

    const asOutsider = await ctx.req("GET", `/guilds/${guild.id}`, {
      token: outsider.token,
    });
    expect(asOutsider.status).toBe(403);
    expect(asOutsider.json.error).toBe("not_member");
    const unknown = await ctx.req("GET", `/guilds/${randomUUID()}`, {
      token: founder.token,
    });
    expect(unknown.status).toBe(403);
    expect(unknown.json.error).toBe("not_member");
    // Malformed ids (also the removed `/guilds/me`) are 404 `not_found`.
    for (const path of ["/guilds/not-a-uuid", "/guilds/me"]) {
      const invalid = await ctx.req("GET", path, { token: founder.token });
      expect(invalid.status, path).toBe(404);
      expect(invalid.json.error).toBe("not_found");
    }

    const asMember = await ctx.req("GET", `/guilds/${guild.id}`, {
      token: m1.token,
    });
    expect(asMember.json).toMatchObject({ myRole: "member", inviteCode: null });
    const asOfficer = await ctx.req("GET", `/guilds/${guild.id}`, {
      token: officer.token,
    });
    expect(asOfficer.json).toMatchObject({
      myRole: "officer",
      inviteCode: guild.inviteCode,
    });
    expect(asOfficer.json.members.map((m: { role: string }) => m.role)).toEqual(
      ["founder", "officer", "member", "member"]
    );
  });

  it("founder and officers manage members by role", async () => {
    const { guild, founder, officer, m1, m2 } = await guildWithRoles();
    const kick = (by: Login, target: Login) =>
      ctx.req("DELETE", `/guilds/${guild.id}/members/${target.id}`, {
        token: by.token,
      });

    const byMember = await kick(m1, m2);
    expect(byMember.status).toBe(403);
    expect(byMember.json.error).toBe("forbidden_role");
    const officerOnFounder = await kick(officer, founder);
    expect(officerOnFounder.status).toBe(403);
    expect(officerOnFounder.json.error).toBe("forbidden_role");
    const self = await kick(founder, founder);
    expect(self.status).toBe(400);
    expect(self.json.error).toBe("cannot_target_self");
    const stranger = await kick(founder, await ctx.login());
    expect(stranger.status).toBe(404);
    expect(stranger.json.error).toBe("member_not_found");

    const officerKick = await kick(officer, m2);
    expect(officerKick.status).toBe(200);
    expect(
      officerKick.json.members.map((m: { playerId: string }) => m.playerId)
    ).not.toContain(m2.id);
    const gone = await ctx.req("GET", `/guilds/${guild.id}`, {
      token: m2.token,
    });
    expect(gone.json.error).toBe("not_member");

    // Roles: founder only, officer <-> member.
    const memberPromotes = await ctx.req(
      "PATCH",
      `/guilds/${guild.id}/members/${m1.id}`,
      { token: officer.token, body: { role: "officer" } }
    );
    expect(memberPromotes.status).toBe(403);
    expect(memberPromotes.json.error).toBe("forbidden_role");
    const badRole = await ctx.req(
      "PATCH",
      `/guilds/${guild.id}/members/${m1.id}`,
      { token: founder.token, body: { role: "founder" } }
    );
    expect(badRole.status).toBe(400);
    const demote = await ctx.req(
      "PATCH",
      `/guilds/${guild.id}/members/${officer.id}`,
      { token: founder.token, body: { role: "member" } }
    );
    expect(demote.status).toBe(200);
    const founderKicksDemoted = await kick(founder, officer);
    expect(founderKicksDemoted.status).toBe(200);
  });

  it("founder and officers renew the invite code; members cannot", async () => {
    const { guild, officer, m1 } = await guildWithRoles();
    const byMember = await ctx.req("POST", `/guilds/${guild.id}/invite-code`, {
      token: m1.token,
    });
    expect(byMember.status).toBe(403);
    expect(byMember.json.error).toBe("forbidden_role");

    const rotate = await ctx.req("POST", `/guilds/${guild.id}/invite-code`, {
      token: officer.token,
    });
    expect(rotate.status).toBe(200);
    expect(rotate.json.inviteCode).not.toBe(guild.inviteCode);
    const oldCode = await ctx.req("POST", "/guilds/join", {
      token: (await ctx.login()).token,
      body: { inviteCode: guild.inviteCode },
    });
    expect(oldCode.status).toBe(404);
    expect(oldCode.json.error).toBe("invalid_invite_code");
    await join(await ctx.login(), rotate.json.inviteCode);
  });

  it("founder leaving passes the role to the oldest officer; the last member disbands", async () => {
    const { guild, founder, officer, m1 } = await guildWithRoles();
    const left = await ctx.req("POST", `/guilds/${guild.id}/leave`, {
      token: founder.token,
    });
    expect(left.status).toBe(200);
    expect(left.json).toEqual({
      guildId: guild.id,
      disbanded: false,
      newFounderId: officer.id,
    });
    const notAgain = await ctx.req("POST", `/guilds/${guild.id}/leave`, {
      token: founder.token,
    });
    expect(notAgain.status).toBe(403);
    expect(notAgain.json.error).toBe("not_member");

    const after = await ctx.req("GET", `/guilds/${guild.id}`, {
      token: officer.token,
    });
    expect(after.json.founderId).toBe(officer.id);
    expect(after.json.myRole).toBe("founder");

    // Everybody else leaves; the last one disbands the guild.
    const rest = after.json.members
      .map((m: { playerId: string }) => m.playerId)
      .filter((id: string) => id !== officer.id) as string[];
    expect(rest).toContain(m1.id);
    const tokens = new Map([[m1.id, m1.token]]);
    for (const id of rest) {
      const token = tokens.get(id);
      if (token) {
        await ctx.req("POST", `/guilds/${guild.id}/leave`, { token });
      } else {
        await ctx.req("DELETE", `/guilds/${guild.id}/members/${id}`, {
          token: officer.token,
        });
      }
    }
    const last = await ctx.req("POST", `/guilds/${guild.id}/leave`, {
      token: officer.token,
    });
    expect(last.json).toMatchObject({ disbanded: true, newFounderId: null });
    const pub = await ctx.req("GET", `/public/guilds/${guild.tag}`);
    expect(pub.status).toBe(404);
  });

  it("progress uses an optimistic version check (no double spending)", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const m = await ctx.login();
    await join(m, guild.inviteCode as string);
    const path = `/guilds/${guild.id}/progress`;

    const deposit = await ctx.req("PATCH", path, {
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
    const buyA = await ctx.req("PATCH", path, {
      token: founder.token,
      body: { version: 1, treasury: 200, forgeLevels: { max_hp: 1 } },
    });
    const buyB = await ctx.req("PATCH", path, {
      token: m.token,
      body: { version: 1, treasury: 100, forgeLevels: { damage: 1 } },
    });
    expect(buyA.status).toBe(200);
    expect(buyB.status).toBe(409);
    expect(buyB.json).toEqual({
      error: "version_conflict",
      current: { treasury: 200, forgeLevels: { max_hp: 1 }, version: 2 },
    });

    const read = await ctx.req("GET", path, { token: m.token });
    expect(read.json).toEqual(buyB.json.current);
    const negative = await ctx.req("PATCH", path, {
      token: m.token,
      body: { version: 2, treasury: -1 },
    });
    expect(negative.status).toBe(400);

    const outsider = await ctx.login();
    for (const method of ["GET", "PATCH"]) {
      const res = await ctx.req(method, path, {
        token: outsider.token,
        body: method === "PATCH" ? { version: 2, treasury: 0 } : undefined,
      });
      expect(res.status, method).toBe(403);
      expect(res.json.error).toBe("not_member");
    }
  });

  it("guild runs pay into the treasury: portal 100 %, otherwise 50 % rounded up (D-081)", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const m = await ctx.login();
    await join(m, guild.inviteCode as string);
    const run = (body: Record<string, unknown>, token = founder.token) =>
      ctx.reportRun(token, {
        mode: "guild",
        guildId: guild.id,
        participants: [founder.id, m.id],
        ...body,
      });

    const portal = await run({ endReason: "portal", remainingGold: 300 });
    expect(portal.status).toBe(201);
    expect(portal.json).toMatchObject({
      flagged: false,
      guildPayout: 300,
      guildProgress: { treasury: 300, version: 1 },
    });
    const wiped = await run(
      { endReason: "wiped", remainingGold: 301 },
      m.token
    );
    expect(wiped.json).toMatchObject({
      guildPayout: 151,
      guildProgress: { treasury: 451, version: 2 },
    });
    const noReason = await run({ remainingGold: 10 });
    expect(noReason.json.guildPayout).toBe(5);
    const noGold = await run({ endReason: "portal" });
    expect(noGold.json).toMatchObject({
      guildPayout: null,
      guildProgress: { treasury: 456, version: 3 },
    });

    // A non-member among the participants flags the run: no payout.
    const outsider = await ctx.login();
    const flagged = await ctx.reportRun(founder.token, {
      mode: "guild",
      guildId: guild.id,
      participants: [founder.id, outsider.id],
      endReason: "portal",
      remainingGold: 1000,
    });
    expect(flagged.json).toMatchObject({
      flagged: true,
      flagReason: "participant_not_in_guild",
      guildPayout: 0,
      guildProgress: { treasury: 456 },
    });

    const list = await ctx.req("GET", "/me/guilds", { token: m.token });
    expect(list.json.items[0].treasury).toBe(456);

    // Other modes never touch a treasury.
    const solo = await ctx.reportRun(founder.token, {
      participants: [founder.id],
      remainingGold: 50,
    });
    expect(solo.json).toMatchObject({ guildPayout: null, guildProgress: null });

    const tooMuch = await run({ remainingGold: 10_000_001 });
    expect(tooMuch.status).toBe(400);
  });

  it("a repeated reportId returns the stored result and pays only once (P-032)", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const reportId = randomUUID();
    const report = () =>
      ctx.reportRun(founder.token, {
        mode: "guild",
        guildId: guild.id,
        participants: [founder.id],
        endReason: "portal",
        remainingGold: 100,
        reportId,
      });

    const first = await report();
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({
      guildPayout: 100,
      guildProgress: { treasury: 100, version: 1 },
    });
    const retry = await report();
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(first.json);

    // Two retries at the same time: still one run, one payout.
    const raceId = randomUUID();
    const race = await Promise.all(
      [1, 2, 3].map(() =>
        ctx.reportRun(founder.token, {
          mode: "guild",
          guildId: guild.id,
          participants: [founder.id],
          endReason: "wiped",
          remainingGold: 40,
          reportId: raceId,
        })
      )
    );
    expect(race.map((r) => r.status).toSorted()).toEqual([200, 200, 201]);
    expect(new Set(race.map((r) => r.json.id)).size).toBe(1);
    expect(race.every((r) => r.json.guildPayout === 20)).toBe(true);

    const progress = await ctx.req("GET", `/guilds/${guild.id}/progress`, {
      token: founder.token,
    });
    expect(progress.json.treasury).toBe(120);
    expect(
      await ctx.db.run.count({
        where: { reportId: { in: [reportId, raceId] } },
      })
    ).toBe(2);

    // Somebody else's reportId is refused.
    const other = await ctx.login();
    const foreign = await ctx.reportRun(other.token, {
      participants: [other.id],
      reportId,
    });
    expect(foreign.status).toBe(409);
    expect(foreign.json.error).toBe("report_id_conflict");

    // Without reportId every report counts (older game builds).
    const plain = await ctx.reportRun(founder.token, {
      participants: [founder.id],
    });
    expect(plain.status).toBe(201);
  });

  it("guild runs of a disbanded guild or by non-members are rejected", async () => {
    const founder = await ctx.login();
    const guild = await createGuild(founder.token);
    const outsider = await ctx.login();
    const byOutsider = await ctx.reportRun(outsider.token, {
      mode: "guild",
      guildId: guild.id,
      participants: [outsider.id],
    });
    expect(byOutsider.status).toBe(403);
    expect(byOutsider.json.error).toBe("not_guild_member");

    await ctx.req("POST", `/guilds/${guild.id}/leave`, {
      token: founder.token,
    });
    const afterDisband = await ctx.reportRun(founder.token, {
      mode: "guild",
      guildId: guild.id,
      participants: [founder.id],
    });
    expect(afterDisband.status).toBe(403);
    expect(afterDisband.json.error).toBe("not_guild_member");
  });

  it("admin player views list every guild of a player", async () => {
    const p = await ctx.login(`Mehrgilde${nextTag()}`);
    const first = await createGuild(p.token);
    const other = await ctx.login();
    const second = await createGuild(other.token);
    await join(p, second.inviteCode as string);
    const mod = await ctx.createAdmin("moderator");

    const detail = await ctx.req("GET", `/admin/players/${p.id}`, {
      token: mod.token,
    });
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({
      guildTag: first.tag,
      guildTags: [first.tag, second.tag],
      guild: { id: first.id, role: "founder" },
      guilds: [
        { id: first.id, tag: first.tag, name: first.name, role: "founder" },
        { id: second.id, tag: second.tag, name: second.name, role: "member" },
      ],
    });
    const list = await ctx.req("GET", `/admin/players?q=${p.id}`, {
      token: mod.token,
    });
    expect(list.json.items[0]).toMatchObject({
      guildTag: first.tag,
      guildTags: [first.tag, second.tag],
    });
  });

  it("deleting the account leaves every guild (founder hand-over, last member disbands)", async () => {
    const p = await ctx.login();
    const solo = await createGuild(p.token);
    const shared = await createGuild(p.token);
    const heir = await ctx.login();
    await join(heir, shared.inviteCode as string);

    expect((await ctx.req("DELETE", "/me", { token: p.token })).status).toBe(
      204
    );
    const after = await ctx.req("GET", `/guilds/${shared.id}`, {
      token: heir.token,
    });
    expect(after.json).toMatchObject({ founderId: heir.id, myRole: "founder" });
    expect((await ctx.req("GET", `/public/guilds/${solo.tag}`)).status).toBe(
      404
    );
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
