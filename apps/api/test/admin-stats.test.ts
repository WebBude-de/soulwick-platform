import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { AdminDailyStats, AdminStats } from "@soulwick/contracts";
import type { RunMode } from "@soulwick/db";
import { createTestContext, type TestContext } from "./helpers.ts";

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

describe("admin statistics", () => {
  let ctx: TestContext;
  let token: string;
  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  async function player(name: string, createdDaysAgo: number) {
    return await ctx.db.player.create({
      data: {
        name,
        createdAt: daysAgo(createdDaysAgo),
        lastSeenAt: daysAgo(createdDaysAgo),
      },
    });
  }

  async function run(
    players: string[],
    opts: {
      mode: RunMode;
      room: number;
      seconds: number;
      daysAgo: number;
      flagged?: boolean;
    }
  ) {
    await ctx.db.run.create({
      data: {
        mode: opts.mode,
        roomReached: opts.room,
        durationSeconds: opts.seconds,
        seed: randomUUID(),
        gameVersion: "1.0.0",
        createdAt: daysAgo(opts.daysAgo),
        flagged: opts.flagged ?? false,
        flagReason: opts.flagged ? "too_fast" : null,
        participants: { create: players.map((playerId) => ({ playerId })) },
      },
    });
  }

  beforeAll(async () => {
    // Own database: the figures below are exact.
    ctx = await createTestContext();
    const p1 = await player("Heute", 0);
    const p2 = await player("Vorgestern", 2);
    const p3 = await player("Alt", 10);
    await run([p1.id], { mode: "solo", room: 12, seconds: 600, daysAgo: 0 });
    await run([p1.id, p2.id], {
      mode: "quick",
      room: 3,
      seconds: 300,
      daysAgo: 2,
    });
    await run([p3.id], { mode: "solo", room: 60, seconds: 1000, daysAgo: 10 });
    await run([p1.id], {
      mode: "solo",
      room: 40,
      seconds: 50,
      daysAgo: 0,
      flagged: true,
    });
    // One guild with a member seen today, one whose only member was last seen 10 days ago.
    for (const [tag, playerId] of [
      ["AKTIV", p1.id],
      ["ALT", p3.id],
    ] as const) {
      await ctx.db.guild.create({
        data: {
          name: `Gilde ${tag}`,
          tag,
          inviteCode: `INV${tag}`,
          founderId: playerId,
          members: { create: { playerId, role: "founder" } },
        },
      });
    }
    token = (await ctx.createAdmin("moderator")).token;
  });
  afterAll(() => ctx.close());

  it("GET /admin/stats adds the activity figures (moderators may read)", async () => {
    const res = await ctx.req("GET", "/admin/stats", { token });
    expect(res.status).toBe(200);
    expect(AdminStats.parse(res.json)).toEqual({
      players: 3,
      activeBans: 0,
      guilds: 2,
      flaggedRuns: 1,
      openDeletionRequests: 0,
      newPlayers7d: 2,
      activePlayers7d: 2,
      runs24h: 2,
      runs7d: 3,
      runsTotal: 4,
      runsByMode: { solo: 3, quick: 1, guild: 0 },
      activeGuilds7d: 1,
      deletions7d: 0,
      newBugReports: 0,
    });
  });

  it("GET /admin/stats/daily returns one entry per UTC day and aggregates only", async () => {
    const res = await ctx.req("GET", "/admin/stats/daily?days=7", { token });
    expect(res.status).toBe(200);
    const stats = AdminDailyStats.parse(res.json);
    expect(stats.days).toBe(7);
    expect(stats.series).toHaveLength(7);
    expect(stats.to).toBe(utcDay(now));
    expect(stats.from).toBe(utcDay(daysAgo(6)));
    expect(stats.series.at(-1)).toEqual({
      date: utcDay(now),
      newPlayers: 1,
      runs: 2,
      activePlayers: 1,
    });
    expect(stats.series.find((d) => d.date === utcDay(daysAgo(2)))).toEqual({
      date: utcDay(daysAgo(2)),
      newPlayers: 1,
      runs: 1,
      activePlayers: 2,
    });
    expect(stats.totals).toEqual({
      newPlayers: 2,
      runs: 3,
      flaggedRuns: 1,
      activePlayers: 2,
      runsByMode: { solo: 2, quick: 1, guild: 0 },
    });
    // Flagged runs stay out of the distribution and the averages.
    expect(stats.roomReached.filter((b) => b.runs > 0)).toEqual([
      { min: 0, max: 5, runs: 1 },
      { min: 11, max: 15, runs: 1 },
    ]);
    expect(stats.averageRoomReached).toBe(7.5);
    expect(stats.averageDurationSeconds).toBe(450);
    expect(stats.medianDurationSeconds).toBe(450);
    expect(JSON.stringify(stats)).not.toContain("Heute");
  });

  it("defaults to 30 days, accepts up to 90 and rejects anything else", async () => {
    const def = await ctx.req("GET", "/admin/stats/daily", { token });
    expect(def.json.days).toBe(30);
    expect(def.json.series).toHaveLength(30);
    expect(def.json.roomReached.at(-1)).toEqual({
      min: 51,
      max: null,
      runs: 1,
    });

    const max = await ctx.req("GET", "/admin/stats/daily?days=90", { token });
    expect(max.json.series).toHaveLength(90);
    for (const days of ["0", "91", "abc"]) {
      const bad = await ctx.req("GET", `/admin/stats/daily?days=${days}`, {
        token,
      });
      expect(bad.status).toBe(400);
      expect(bad.json.error).toBe("validation_error");
    }
  });

  it("an empty window has zeros and null averages; player tokens are rejected", async () => {
    const empty = await createTestContext();
    try {
      const admin = await empty.createAdmin("admin");
      const res = await empty.req("GET", "/admin/stats/daily?days=1", {
        token: admin.token,
      });
      expect(res.json).toMatchObject({
        series: [{ newPlayers: 0, runs: 0, activePlayers: 0 }],
        averageRoomReached: null,
        averageDurationSeconds: null,
        medianDurationSeconds: null,
      });
      const p = await empty.login();
      expect(
        (await empty.req("GET", "/admin/stats/daily", { token: p.token }))
          .status
      ).toBe(401);
    } finally {
      await empty.close();
    }
  });
});
