import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { seasonRange } from "../src/services/leaderboard.ts";
import { checkPlausibility } from "../src/services/plausibility.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

describe("plausibility", () => {
  const cfg = { MIN_SECONDS_PER_ROOM: 8, KNOWN_GAME_VERSIONS: ["1.0.0"] };
  it("flags too-fast runs and unknown versions", () => {
    expect(
      checkPlausibility(
        { roomReached: 10, durationSeconds: 80, gameVersion: "1.0.0" },
        cfg
      )
    ).toBeNull();
    expect(
      checkPlausibility(
        { roomReached: 10, durationSeconds: 79, gameVersion: "1.0.0" },
        cfg
      )
    ).toBe("too_fast");
    expect(
      checkPlausibility(
        { roomReached: 1, durationSeconds: 100, gameVersion: "6.6.6" },
        cfg
      )
    ).toBe("unknown_game_version");
    expect(
      checkPlausibility(
        { roomReached: 1, durationSeconds: 100, gameVersion: "x" },
        { ...cfg, KNOWN_GAME_VERSIONS: [] }
      )
    ).toBe(null);
  });

  it("computes season ranges in UTC", () => {
    const { start, end } = seasonRange("2026-12");
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("runs", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("stores plausible runs unflagged and suspicious runs flagged", async () => {
    const p = await ctx.login();
    const ok = await ctx.reportRun(p.token, {
      participants: [p.id],
      roomReached: 10,
      durationSeconds: 80,
    });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ flagged: false, flagReason: null });

    const fast = await ctx.reportRun(p.token, {
      participants: [p.id],
      roomReached: 30,
      durationSeconds: 60,
    });
    expect(fast.status).toBe(201);
    expect(fast.json).toMatchObject({ flagged: true, flagReason: "too_fast" });

    const version = await ctx.reportRun(p.token, {
      participants: [p.id],
      gameVersion: "9.9.9",
    });
    expect(version.json.flagReason).toBe("unknown_game_version");
  });

  it("validates reporter, participants and mode rules", async () => {
    const p = await ctx.login();
    const q = await ctx.login();
    expect(
      (await ctx.reportRun(p.token, { participants: [q.id] })).json.error
    ).toBe("reporter_not_participant");
    expect(
      (
        await ctx.reportRun(p.token, {
          mode: "quick",
          participants: [p.id, randomUUID()],
        })
      ).json.error
    ).toBe("unknown_participants");
    expect(
      (
        await ctx.reportRun(p.token, {
          mode: "solo",
          participants: [p.id, q.id],
        })
      ).status
    ).toBe(400);
    expect(
      (await ctx.reportRun(p.token, { mode: "guild", participants: [p.id] }))
        .status
    ).toBe(400);
  });

  it("guild runs require membership; non-member participants get flagged", async () => {
    const f = await ctx.login();
    const outsider = await ctx.login();
    const g = (
      await ctx.req("POST", "/guilds", {
        token: f.token,
        body: { name: "Run Guild", tag: "RUNG" },
      })
    ).json;
    const byOutsider = await ctx.reportRun(outsider.token, {
      mode: "guild",
      guildId: g.id,
      participants: [outsider.id],
    });
    expect(byOutsider.status).toBe(403);
    const mixed = await ctx.reportRun(f.token, {
      mode: "guild",
      guildId: g.id,
      participants: [f.id, outsider.id],
    });
    expect(mixed.status).toBe(201);
    expect(mixed.json.flagReason).toBe("participant_not_in_guild");
  });
});

describe("leaderboards", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("ranks by highest room, then shorter duration, best run per player; excludes flagged and banned", async () => {
    const a = await ctx.login("Alpha");
    const b = await ctx.login("Bravo");
    const c = await ctx.login("Charlie");
    const cheater = await ctx.login("Cheater");
    const flaggedOnly = await ctx.login("Flagged");

    await ctx.reportRun(a.token, {
      participants: [a.id],
      roomReached: 20,
      durationSeconds: 1200,
    });
    await ctx.reportRun(a.token, {
      participants: [a.id],
      roomReached: 15,
      durationSeconds: 300,
    }); // worse, ignored
    await ctx.reportRun(b.token, {
      participants: [b.id],
      roomReached: 20,
      durationSeconds: 1000,
    }); // same room, faster
    await ctx.reportRun(c.token, {
      participants: [c.id],
      roomReached: 25,
      durationSeconds: 2000,
    });
    await ctx.reportRun(cheater.token, {
      participants: [cheater.id],
      roomReached: 99,
      durationSeconds: 5000,
    });
    const flagged = await ctx.reportRun(flaggedOnly.token, {
      participants: [flaggedOnly.id],
      roomReached: 50,
      durationSeconds: 10, // too fast → flagged
    });
    expect(flagged.json.flagged).toBe(true);

    const admin = await ctx.createAdmin("admin");
    await ctx.req("POST", `/admin/players/${cheater.id}/bans`, {
      token: admin.token,
      body: { reason: "Speedhack", durationDays: null },
    });

    const board = await ctx.req("GET", "/leaderboards/solo?period=all", {
      token: a.token,
    });
    expect(board.status).toBe(200);
    expect(board.json.entries.map((e: { name: string }) => e.name)).toEqual([
      "Charlie",
      "Bravo",
      "Alpha",
    ]);
    expect(board.json.entries.map((e: { rank: number }) => e.rank)).toEqual([
      1, 2, 3,
    ]);
    expect(board.json.entries[2]).toMatchObject({
      roomReached: 20,
      durationSeconds: 1200,
    });
    expect(board.json.own).toMatchObject({ id: a.id, rank: 3 });

    const anonymous = await ctx.req("GET", "/leaderboards/solo?limit=1");
    expect(anonymous.json.entries).toHaveLength(1);
    expect(anonymous.json.own).toBeNull();

    // Group board counts quick/guild runs per player.
    await ctx.reportRun(a.token, {
      mode: "quick",
      participants: [a.id, b.id],
      roomReached: 7,
      durationSeconds: 500,
    });
    const group = await ctx.req("GET", "/leaderboards/group");
    expect(group.json.entries).toHaveLength(2);
    expect(
      group.json.entries.every((e: { rank: number }) => e.rank === 1)
    ).toBe(true);

    // Unflagging by a moderator releases the run.
    const mod = await ctx.createAdmin("moderator");
    await ctx.req("POST", `/admin/runs/${flagged.json.id}/unflag`, {
      token: mod.token,
    });
    const afterUnflag = await ctx.req("GET", "/leaderboards/solo");
    expect(afterUnflag.json.entries[0].name).toBe("Flagged");
  });

  it("guild board ranks guilds and supports seasons", async () => {
    const f1 = await ctx.login();
    const f2 = await ctx.login();
    const g1 = (
      await ctx.req("POST", "/guilds", {
        token: f1.token,
        body: { name: "Erste Gilde", tag: "ONE" },
      })
    ).json;
    const g2 = (
      await ctx.req("POST", "/guilds", {
        token: f2.token,
        body: { name: "Zweite Gilde", tag: "TWO" },
      })
    ).json;
    await ctx.reportRun(f1.token, {
      mode: "guild",
      guildId: g1.id,
      participants: [f1.id],
      roomReached: 10,
      durationSeconds: 900,
    });
    await ctx.reportRun(f2.token, {
      mode: "guild",
      guildId: g2.id,
      participants: [f2.id],
      roomReached: 11,
      durationSeconds: 950,
    });

    const board = await ctx.req("GET", "/leaderboards/guild", {
      token: f1.token,
    });
    expect(board.json.entries.map((e: { tag: string }) => e.tag)).toEqual([
      "TWO",
      "ONE",
    ]);
    expect(board.json.entries[0].memberCount).toBe(1);
    expect(board.json.own).toMatchObject({ id: g1.id, rank: 2 });

    const now = new Date();
    const season = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = await ctx.req("GET", "/leaderboards/guild?period=season");
    expect(current.json.season).toBe(season);
    expect(current.json.entries).toHaveLength(2);
    const old = await ctx.req(
      "GET",
      "/leaderboards/guild?period=season&season=2020-01"
    );
    expect(old.json.entries).toHaveLength(0);

    expect((await ctx.req("GET", "/leaderboards/nope")).status).toBe(404);
    expect(
      (await ctx.req("GET", "/leaderboards/solo?season=2020-13&period=season"))
        .status
    ).toBe(400);
  });
});
