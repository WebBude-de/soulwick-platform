import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AccountSummary,
  AddXpResponse,
  accountLevel,
  GuildDetail,
  LeaderboardResponse,
  levelForXp,
  PlayerSelf,
  runXp,
  XP_ENTRIES_PER_REQUEST,
  XP_MAX_PER_DAY,
  XP_MAX_PER_RUN,
  type XpEntry,
  xpForLevel,
} from "@soulwick/contracts";
import { createTestContext, type TestContext } from "./helpers.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Noon UTC of the current day: tests move the clock in whole days without crossing midnight by accident. */
const NOON = new Date(
  Math.floor(Date.now() / DAY_MS) * DAY_MS + 12 * HOUR_MS
).getTime();

describe("level curve and run XP (contract, D-188)", () => {
  it("50·L·(L−1) and its inverse", () => {
    expect([1, 2, 3, 5, 10, 20, 50].map((level) => xpForLevel(level))).toEqual([
      0, 100, 300, 1000, 4500, 19_000, 122_500,
    ]);
    expect(
      [0, 99, 100, 299, 300, 999, 1000, 122_499, 122_500].map(levelForXp)
    ).toEqual([1, 1, 2, 2, 3, 4, 5, 49, 50]);
    expect(accountLevel(340)).toEqual({
      xp: 340,
      level: 3,
      levelStartXp: 300,
      nextLevelXp: 600,
      xpToNextLevel: 260,
    });
    // Every level boundary up to 200 matches exactly (no float rounding at the edges).
    for (let level = 1; level <= 200; level += 1) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      expect(levelForXp(xpForLevel(level + 1) - 1)).toBe(level);
    }
  });

  it("room 5, champion 10, boss 50, record 5, portal 20, first run 25, co-op +20 % rounded down, cap", () => {
    const solo = runXp({
      rooms: 6,
      champions: 1,
      bosses: 0,
      recordRooms: 6,
      endReason: "wiped",
      firstRunOfDay: true,
      players: 1,
    });
    expect(solo).toEqual({
      rooms: 30,
      champions: 10,
      bosses: 0,
      record: 30,
      portal: 0,
      firstRunOfDay: 25,
      coopBonus: 0,
      total: 95,
      capped: false,
    });
    const coop = runXp({
      rooms: 7,
      champions: 0,
      bosses: 1,
      recordRooms: 0,
      endReason: "portal",
      firstRunOfDay: false,
      players: 3,
    });
    // 35 + 50 + 20 = 105, +20 % = 21.
    expect(coop.coopBonus).toBe(21);
    expect(coop.total).toBe(126);
    const big = runXp({
      rooms: 400,
      champions: 0,
      bosses: 0,
      recordRooms: 0,
      endReason: "portal",
      firstRunOfDay: false,
      players: 1,
    });
    expect(big).toMatchObject({ total: XP_MAX_PER_RUN, capped: true });
  });
});

describe("POST /me/xp (KF3)", () => {
  let ctx: TestContext;
  let offsetMs = 0;
  beforeAll(async () => {
    ctx = await createTestContext({}, { now: () => new Date(NOON + offsetMs) });
  });
  afterAll(() => ctx.close());

  const now = () => new Date(NOON + offsetMs);
  const entry = (extra: Partial<XpEntry> = {}): XpEntry => ({
    runId: randomUUID(),
    endedAt: now().toISOString(),
    durationSeconds: 900,
    gameVersion: "1.0.0",
    rooms: 6,
    champions: 1,
    bosses: 0,
    deepestRoom: 6,
    endReason: "wiped",
    players: 1,
    ...extra,
  });
  const post = (token: string, entries: unknown[]) =>
    ctx.req("POST", "/me/xp", { token, body: { entries } });
  const me = async (token: string) =>
    PlayerSelf.parse((await ctx.req("GET", "/me", { token })).json);

  it("credits a run once: duplicate on retry, record and first run of the day from the account", async () => {
    const p = await ctx.login();
    expect(await me(p.token)).toMatchObject({
      xp: 0,
      level: 1,
      levelStartXp: 0,
      nextLevelXp: 100,
      xpToNextLevel: 100,
    });

    const first = entry();
    const res = await post(p.token, [first]);
    expect(res.status).toBe(200);
    const body = AddXpResponse.parse(res.json);
    expect(body.entries).toEqual([
      {
        runId: first.runId,
        status: "credited",
        xp: 95,
        breakdown: {
          rooms: 30,
          champions: 10,
          bosses: 0,
          record: 30,
          portal: 0,
          firstRunOfDay: 25,
          coopBonus: 0,
          total: 95,
          capped: false,
        },
        flagReason: null,
      },
    ]);
    expect(body.account).toEqual(accountLevel(95));
    expect(body.dailyXpLeft).toBe(XP_MAX_PER_DAY - 95);
    expect(body.dailyResetAt).toBe(new Date(NOON + 12 * HOUR_MS).toISOString());

    // Retry (lost answer): nothing is added.
    const again = AddXpResponse.parse((await post(p.token, [first])).json);
    expect(again.entries[0]).toMatchObject({ status: "duplicate", xp: 95 });
    expect(again.account.xp).toBe(95);

    // Same day, two rooms deeper, co-op with the portal: record 2 rooms, no first-run bonus.
    const second = AddXpResponse.parse(
      (
        await post(p.token, [
          entry({
            rooms: 8,
            champions: 0,
            deepestRoom: 8,
            endReason: "portal",
            players: 2,
          }),
        ])
      ).json
    );
    // 40 + 10 + 20 = 70, +20 % = 14.
    expect(second.entries[0]?.breakdown).toMatchObject({
      record: 10,
      firstRunOfDay: 0,
      coopBonus: 14,
      total: 84,
    });
    expect(await me(p.token)).toMatchObject({
      xp: 179,
      level: 2,
      levelStartXp: 100,
      nextLevelXp: 300,
      xpToNextLevel: 121,
    });

    // An offline run of yesterday gets its own first-run bonus, but no record (not deeper).
    const yesterday = AddXpResponse.parse(
      (
        await post(p.token, [
          entry({
            endedAt: new Date(NOON - DAY_MS).toISOString(),
            rooms: 1,
            champions: 0,
            deepestRoom: 1,
          }),
        ])
      ).json
    );
    expect(yesterday.entries[0]?.breakdown).toMatchObject({
      record: 0,
      firstRunOfDay: 25,
      total: 30,
    });
  });

  it("flags implausible runs with 0 XP like run reports; a retry stays flagged", async () => {
    const p = await ctx.login();
    const tooFast = entry({ durationSeconds: 10, rooms: 20, deepestRoom: 20 });
    const unknownVersion = entry({ gameVersion: "0.1.0" });
    const body = AddXpResponse.parse(
      (await post(p.token, [tooFast, unknownVersion])).json
    );
    expect(body.entries.map((e) => [e.status, e.xp, e.flagReason])).toEqual([
      ["flagged", 0, "too_fast"],
      ["flagged", 0, "unknown_game_version"],
    ]);
    expect(body.account.xp).toBe(0);
    const again = AddXpResponse.parse((await post(p.token, [tooFast])).json);
    expect(again.entries[0]).toMatchObject({
      status: "duplicate",
      xp: 0,
      flagReason: "too_fast",
    });
    // A flagged run sets no record: the next real run still gets the record bonus.
    const real = AddXpResponse.parse(
      (await post(p.token, [entry({ deepestRoom: 3, rooms: 3 })])).json
    );
    expect(real.entries[0]?.breakdown).toMatchObject({
      record: 15,
      firstRunOfDay: 25,
    });
  });

  it("defers entries over the daily cap and credits them after UTC midnight", async () => {
    const p = await ctx.login();
    const capped = () =>
      entry({ rooms: 500, deepestRoom: 500, durationSeconds: 6 * 3600 });
    const perDay = XP_MAX_PER_DAY / XP_MAX_PER_RUN;
    const batch = Array.from({ length: perDay + 1 }, capped);
    const body = AddXpResponse.parse((await post(p.token, batch)).json);
    expect(
      body.entries.slice(0, perDay).every((e) => e.xp === XP_MAX_PER_RUN)
    ).toBe(true);
    const last = body.entries[perDay];
    expect(last?.status).toBe("deferred");
    expect(last?.xp).toBe(0);
    expect(last?.breakdown?.total).toBe(XP_MAX_PER_RUN);
    expect(body.account.xp).toBe(XP_MAX_PER_DAY);
    expect(body.dailyXpLeft).toBe(0);

    // After UTC midnight the deferred entry goes through.
    offsetMs = DAY_MS;
    try {
      const next = AddXpResponse.parse(
        (await post(p.token, [batch[perDay]])).json
      );
      expect(next.entries[0]?.status).toBe("credited");
      expect(next.account.xp).toBe(XP_MAX_PER_DAY + XP_MAX_PER_RUN);
      expect(next.dailyXpLeft).toBe(XP_MAX_PER_DAY - XP_MAX_PER_RUN);
    } finally {
      offsetMs = 0;
    }
  });

  it("sets endedAt from the future to the server time", async () => {
    const p = await ctx.login();
    const future = entry({
      endedAt: new Date(NOON + 3 * DAY_MS).toISOString(),
    });
    expect((await post(p.token, [future])).status).toBe(200);
    const row = await ctx.db.xpEntry.findFirstOrThrow({
      where: { runId: future.runId },
    });
    expect(row.endedAt.getTime()).toBe(NOON);
    expect(row.day.toISOString().slice(0, 10)).toBe(
      new Date(NOON).toISOString().slice(0, 10)
    );
  });

  it("answers 400 for bad bodies, 401 without a session and 403 for banned players", async () => {
    const p = await ctx.login();
    const one = entry();
    const bad: unknown[][] = [
      [],
      [one, { ...one }],
      [entry({ players: 5 })],
      [{ ...entry(), runId: "not-a-uuid" }],
      [{ ...entry(), rooms: -1 }],
      [{ ...entry(), endReason: "won" }],
      Array.from({ length: XP_ENTRIES_PER_REQUEST + 1 }, () => entry()),
    ];
    for (const entries of bad) {
      const res = await post(p.token, entries);
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("validation_error");
    }
    const anonymous = await ctx.req("POST", "/me/xp", {
      body: { entries: [entry()] },
    });
    expect(anonymous.status).toBe(401);

    const mod = await ctx.createAdmin("moderator");
    const ban = await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Testsperre", durationDays: 1 },
    });
    expect(ban.status).toBe(201);
    const banned = await post(p.token, [entry()]);
    expect(banned.status).toBe(403);
    expect(banned.json.error).toBe("banned");
  });

  it("shows the level on guild members, leaderboard entries, the relay status and the admin detail", async () => {
    const p = await ctx.login("Levelprobe");
    // 300 XP = level 3: three runs worth 100 each are simplest via the database.
    await ctx.db.player.update({ where: { id: p.id }, data: { xp: 300 } });

    const guild = await ctx.req("POST", "/guilds", {
      token: p.token,
      body: { name: "Levelgilde", tag: "LVL" },
    });
    expect(guild.status).toBe(201);
    expect(GuildDetail.parse(guild.json).members[0]?.level).toBe(3);

    expect(
      (await ctx.reportRun(p.token, { participants: [p.id] })).status
    ).toBe(201);
    const board = LeaderboardResponse.parse(
      (await ctx.req("GET", "/leaderboards/solo", { token: p.token })).json
    );
    expect(board.own?.level).toBe(3);
    const guildBoard = LeaderboardResponse.parse(
      (await ctx.req("GET", "/leaderboards/guild")).json
    );
    for (const e of guildBoard.entries) {
      expect(e.level).toBeNull();
    }

    const admin = await ctx.createAdmin("moderator");
    const detail = await ctx.req("GET", `/admin/players/${p.id}`, {
      token: admin.token,
    });
    expect(detail.json).toMatchObject({ xp: 300, level: 3 });
  });

  it("merging adds the XP of both accounts, a shared run id once; XP alone counts as progress", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    const shared = entry({ rooms: 2, deepestRoom: 2, champions: 0 });
    await post(a.token, [shared, entry()]);
    await post(b.token, [shared]);
    const before = (await me(a.token)).xp ?? 0;
    // a: 2 rooms (10 + record 10 + first 25 = 45), then 6 rooms (30 + 10 + record 20 = 60).
    expect(before).toBe(105);
    expect((await me(b.token)).xp).toBe(45);
    // b is older, so b stays.
    await ctx.db.player.update({
      where: { id: b.id },
      data: { createdAt: new Date(NOON - 10 * DAY_MS) },
    });

    const code = (await ctx.req("POST", "/me/link-code", { token: b.token }))
      .json.code as string;
    const ask = await ctx.req("POST", "/me/link", {
      token: a.token,
      body: { code },
    });
    expect(ask.status).toBe(409);
    expect(ask.json.error).toBe("account_has_progress");
    expect(AccountSummary.parse(ask.json.removed)).toMatchObject({
      id: a.id,
      xp: 105,
      level: 2,
      runCount: 0,
    });

    const merged = await ctx.req("POST", "/me/link", {
      token: a.token,
      body: { code, confirmMerge: true },
    });
    expect(merged.status).toBe(200);
    expect(merged.json.player.id).toBe(b.id);
    // b's own 45 plus a's second run (60); the shared run id counts once.
    expect(merged.json.player.xp).toBe(105);
    expect(await ctx.db.xpEntry.count({ where: { playerId: b.id } })).toBe(2);
  });

  it("deleting the account deletes its XP entries", async () => {
    const p = await ctx.login();
    await post(p.token, [entry(), entry()]);
    expect(await ctx.db.xpEntry.count({ where: { playerId: p.id } })).toBe(2);
    const res = await ctx.req("DELETE", "/me", { token: p.token });
    expect(res.status).toBe(204);
    expect(await ctx.db.xpEntry.count({ where: { playerId: p.id } })).toBe(0);
  });
});
