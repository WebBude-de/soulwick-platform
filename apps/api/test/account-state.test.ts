import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  ACCOUNT_STATE_MAX_BODY_BYTES,
  ACCOUNT_STATE_MAX_SEEN,
  ACCOUNT_STATE_MAX_SPELLS,
  AccountState,
  AddXpResponse,
  DANGER_MAX,
  dangerFromLevel,
  dangerFromSkill,
  dangerLevel,
  GuildDetail,
  LeaderboardResponse,
  medianRoom,
  PlayerSelf,
  PutAccountStateResponse,
  rankForDanger,
  runXp,
  talentPointsForLevel,
  type XpEntry,
  xpForLevel,
} from "@soulwick/contracts";
import { createTestContext, type TestContext } from "./helpers.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOON = new Date(
  Math.floor(Date.now() / DAY_MS) * DAY_MS + 12 * HOUR_MS
).getTime();

describe("danger level and rank (contract, D-194, D-196)", () => {
  it("level part floor((L − 1) / 2), median rounded down, skill part from the 5 newest runs", () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(dangerFromLevel)).toEqual([
      0, 0, 1, 1, 2, 2, 24,
    ]);
    expect(medianRoom([])).toBe(0);
    expect(medianRoom([7])).toBe(7);
    expect(medianRoom([9, 3])).toBe(6);
    expect(medianRoom([3, 10])).toBe(6);
    expect(medianRoom([5, 1, 9])).toBe(5);
    expect(medianRoom([4, 1, 3, 2])).toBe(2);

    // Fewer than 3 runs: unknown, the level decides alone.
    expect(dangerFromSkill([])).toBeNull();
    expect(dangerFromSkill([30, 30])).toBeNull();
    expect(dangerFromSkill([10, 12, 14])).toBe(3);
    expect(dangerFromSkill([0, 1, 4])).toBe(1);
    // Only the 5 newest (first) values count.
    expect(dangerFromSkill([0, 0, 0, 50, 50, 99, 99])).toBe(1);
    expect(dangerFromSkill([50, 50, 50, 0, 0, 0, 0])).toBe(11);
  });

  it("G = min(G_level, G_skill), G_level alone below 3 runs", () => {
    expect(dangerLevel(20, [10, 12, 14])).toBe(3);
    expect(dangerLevel(3, [100, 100, 100])).toBe(1);
    expect(dangerLevel(9, [1, 2])).toBe(4);
    expect(dangerLevel(1, [])).toBe(0);
    // Balance: whoever reaches room 5·G on average stays at G.
    expect(dangerLevel(99, [20, 20, 20, 20, 20])).toBe(5);
  });

  it("ranks spark, candle, flame, lantern, beacon I–III, then soul master G − 14", () => {
    const at = (g: number) => {
      const r = rankForDanger(g);
      return `${r.tier} ${r.step}`;
    };
    expect([0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 16, 30].map(at)).toEqual([
      "spark 1",
      "spark 2",
      "spark 3",
      "candle 1",
      "candle 3",
      "flame 1",
      "flame 3",
      "lantern 1",
      "lantern 3",
      "beacon 1",
      "beacon 3",
      "soul_master 1",
      "soul_master 2",
      "soul_master 16",
    ]);
  });

  it("XP × (1 + 0.05 · G) after the co-op bonus, rounded down, G capped at DANGER_MAX, before the run cap", () => {
    const base = {
      rooms: 6,
      champions: 1,
      bosses: 0,
      recordRooms: 6,
      endReason: "wiped" as const,
      firstRunOfDay: true,
      players: 1,
    };
    expect(runXp(base)).toMatchObject({ danger: 0, dangerBonus: 0, total: 95 });
    // 95 · 20 % = 19.
    expect(runXp({ ...base, danger: 4 })).toMatchObject({
      danger: 4,
      dangerBonus: 19,
      total: 114,
    });
    // Co-op: 105 + 21 = 126, then 126 · 15 % = 18.9 -> 18.
    expect(
      runXp({
        rooms: 7,
        champions: 0,
        bosses: 1,
        recordRooms: 0,
        endReason: "portal",
        firstRunOfDay: false,
        players: 3,
        danger: 3,
      })
    ).toMatchObject({ coopBonus: 21, dangerBonus: 18, total: 144 });
    // Above the cap the bonus counts as DANGER_MAX: 95 · 150 % = 142.
    expect(runXp({ ...base, danger: 50 })).toMatchObject({
      danger: DANGER_MAX,
      dangerBonus: 142,
      total: 237,
    });
    expect(
      runXp({ ...base, rooms: 300, danger: 10 }).capped &&
        runXp({ ...base, rooms: 300 }).capped === false
    ).toBe(true);
  });

  it("one talent point per level from level 2", () => {
    expect([0, 1, 2, 7, 50].map(talentPointsForLevel)).toEqual([
      0, 0, 1, 6, 49,
    ]);
  });
});

describe("/me/state and danger level on the server (KF3b)", () => {
  let ctx: TestContext;
  let offsetMs = 0;
  beforeAll(async () => {
    ctx = await createTestContext({}, { now: () => new Date(NOON + offsetMs) });
  });
  afterAll(() => ctx.close());

  const now = () => new Date(NOON + offsetMs);
  const at = (deltaMs: number) => new Date(NOON + deltaMs).toISOString();
  const getState = async (token: string) => {
    const res = await ctx.req("GET", "/me/state", { token });
    expect(res.status).toBe(200);
    return AccountState.parse(res.json);
  };
  const put = (token: string, body: unknown) =>
    ctx.req("PUT", "/me/state", { token, body });
  const setLevel = (playerId: string, level: number) =>
    ctx.db.player.update({
      where: { id: playerId },
      data: { xp: xpForLevel(level) },
    });
  const xpEntry = (extra: Partial<XpEntry> = {}): XpEntry => ({
    runId: randomUUID(),
    endedAt: now().toISOString(),
    durationSeconds: 3600,
    gameVersion: "1.0.0",
    rooms: 6,
    champions: 0,
    bosses: 0,
    deepestRoom: 6,
    endReason: "wiped",
    players: 1,
    ...extra,
  });
  const postXp = (token: string, entries: XpEntry[]) =>
    ctx.req("POST", "/me/xp", { token, body: { entries } });

  it("a new account has an empty state, level 1, no points, danger 0 and rank spark I", async () => {
    const p = await ctx.login();
    expect(await getState(p.token)).toEqual({
      talents: {},
      spells: [],
      changedAt: null,
      seen: [],
      updatedAt: null,
      level: 1,
      talentPoints: 0,
      talentPointsSpent: 0,
      danger: 0,
      rank: { tier: "spark", step: 1 },
      recentRuns: [],
    });
    expect(
      PlayerSelf.parse((await ctx.req("GET", "/me", { token: p.token })).json)
    ).toMatchObject({ danger: 0, rank: { tier: "spark", step: 1 } });
  });

  it("stores the build within level − 1 points; 409 talent_points_exceeded beyond, nothing stored", async () => {
    const p = await ctx.login();
    const build = {
      talents: { wind_light_foot: 2, ember_vitality: 1, soul_light_flash: 0 },
      spells: ["light_flash"],
      changedAt: at(-HOUR_MS),
    };
    const tooMany = await put(p.token, { ...build, seen: ["explain.forge"] });
    expect(tooMany.status).toBe(409);
    expect(tooMany.json).toMatchObject({
      error: "talent_points_exceeded",
      level: 1,
      talentPoints: 0,
      talentPointsSpent: 3,
    });
    expect(await ctx.db.accountState.count({ where: { playerId: p.id } })).toBe(
      0
    );

    await setLevel(p.id, 4);
    const res = await put(p.token, build);
    expect(res.status).toBe(200);
    const body = PutAccountStateResponse.parse(res.json);
    expect(body).toMatchObject({
      talentsApplied: true,
      // Level 0 is "not taken" and not stored.
      talents: { wind_light_foot: 2, ember_vitality: 1 },
      spells: ["light_flash"],
      changedAt: build.changedAt,
      updatedAt: now().toISOString(),
      level: 4,
      talentPoints: 3,
      talentPointsSpent: 3,
    });
    expect(Object.keys(body.talents)).toEqual([
      "ember_vitality",
      "wind_light_foot",
    ]);
    expect(await getState(p.token)).toMatchObject({
      talents: body.talents,
      spells: ["light_flash"],
    });
  });

  it("last change wins: an older build is ignored (talentsApplied false), seen flags still unite", async () => {
    const p = await ctx.login();
    await setLevel(p.id, 10);
    const newer = {
      talents: { ember_vitality: 5 },
      spells: ["flame_ring", "light_flash"],
      changedAt: at(-HOUR_MS),
      seen: ["explain.forge", "explain.danger"],
    };
    expect((await put(p.token, newer)).status).toBe(200);

    const older = await put(p.token, {
      talents: { wind_light_foot: 1 },
      spells: [],
      changedAt: at(-2 * HOUR_MS),
      seen: ["explain.trader", "explain.forge"],
    });
    expect(older.status).toBe(200);
    expect(PutAccountStateResponse.parse(older.json)).toMatchObject({
      talentsApplied: false,
      talents: { ember_vitality: 5 },
      spells: ["flame_ring", "light_flash"],
      changedAt: newer.changedAt,
      seen: ["explain.danger", "explain.forge", "explain.trader"],
    });

    // Seen flags alone; the build stays.
    const seenOnly = PutAccountStateResponse.parse(
      (await put(p.token, { seen: ["tutorial.done"] })).json
    );
    expect(seenOnly).toMatchObject({
      talentsApplied: false,
      talents: { ember_vitality: 5 },
      seen: [
        "explain.danger",
        "explain.forge",
        "explain.trader",
        "tutorial.done",
      ],
    });

    // A newer build (also an empty one, after re-skilling) replaces it.
    const reset = PutAccountStateResponse.parse(
      (
        await put(p.token, {
          talents: {},
          spells: [],
          changedAt: at(-30 * 60_000),
        })
      ).json
    );
    expect(reset).toMatchObject({
      talentsApplied: true,
      talents: {},
      spells: [],
      talentPointsSpent: 0,
    });
  });

  it("caps changedAt from the future to the server time", async () => {
    const p = await ctx.login();
    await setLevel(p.id, 3);
    const future = PutAccountStateResponse.parse(
      (
        await put(p.token, {
          talents: { ember_vitality: 1 },
          spells: [],
          changedAt: at(3 * DAY_MS),
        })
      ).json
    );
    expect(future.changedAt).toBe(now().toISOString());
    // A real change a minute later still wins against the capped time.
    offsetMs = 60_000;
    try {
      const later = PutAccountStateResponse.parse(
        (
          await put(p.token, {
            talents: { wind_light_foot: 2 },
            spells: [],
            changedAt: now().toISOString(),
          })
        ).json
      );
      expect(later).toMatchObject({
        talentsApplied: true,
        talents: { wind_light_foot: 2 },
      });
    } finally {
      offsetMs = 0;
    }
  });

  it("409 seen_limit_reached when the union would exceed ACCOUNT_STATE_MAX_SEEN", async () => {
    const p = await ctx.login();
    const full = Array.from(
      { length: ACCOUNT_STATE_MAX_SEEN },
      (_, i) => `flag.${String(i).padStart(4, "0")}`
    );
    expect((await put(p.token, { seen: full })).status).toBe(200);
    // Known flags are fine.
    expect((await put(p.token, { seen: full.slice(0, 3) })).status).toBe(200);
    const res = await put(p.token, { seen: ["flag.new"] });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({
      error: "seen_limit_reached",
      maxSeen: ACCOUNT_STATE_MAX_SEEN,
    });
    expect((await getState(p.token)).seen).toHaveLength(ACCOUNT_STATE_MAX_SEEN);
  });

  it("answers 400 for bad bodies, 413 for huge ones, 401 without a session, 403 when banned", async () => {
    const p = await ctx.login();
    const ok = { talents: {}, spells: [], changedAt: at(0) };
    const bad: unknown[] = [
      {},
      { talents: {} },
      { talents: {}, spells: [] },
      { spells: [], changedAt: at(0) },
      { ...ok, talents: { "Bad-Id": 1 } },
      { ...ok, talents: { ember_vitality: 11 } },
      { ...ok, talents: { ember_vitality: -1 } },
      { ...ok, talents: { ember_vitality: 1.5 } },
      {
        ...ok,
        talents: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`t${i}`, 0])
        ),
      },
      { ...ok, spells: ["light_flash", "light_flash"] },
      {
        ...ok,
        spells: Array.from(
          { length: ACCOUNT_STATE_MAX_SPELLS + 1 },
          (_, i) => `s${i}`
        ),
      },
      { ...ok, changedAt: "yesterday" },
      { seen: ["Explain Forge"] },
      { seen: ["x".repeat(65)] },
    ];
    for (const body of bad) {
      const res = await put(p.token, body);
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("validation_error");
    }
    const huge = await put(p.token, {
      seen: ["x".repeat(ACCOUNT_STATE_MAX_BODY_BYTES)],
    });
    expect(huge.status).toBe(413);
    expect(huge.json.error).toBe("payload_too_large");

    expect((await ctx.req("GET", "/me/state")).status).toBe(401);
    expect((await ctx.req("PUT", "/me/state", { body: ok })).status).toBe(401);

    const mod = await ctx.createAdmin("moderator");
    await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Testsperre", durationDays: 1 },
    });
    const banned = await ctx.req("GET", "/me/state", { token: p.token });
    expect(banned.status).toBe(403);
    expect(banned.json.error).toBe("banned");
  });

  it("derives danger level and rank from the level and the 5 newest unflagged runs; XP grow with the reported danger", async () => {
    const p = await ctx.login();
    await setLevel(p.id, 21);
    // Two runs: too few, G = G_level = 10 (lantern II).
    const early = [10, 12].map((room, i) =>
      xpEntry({
        deepestRoom: room,
        rooms: room,
        endedAt: at((i - 10) * HOUR_MS),
      })
    );
    expect((await postXp(p.token, early)).status).toBe(200);
    expect(await getState(p.token)).toMatchObject({
      level: 21,
      danger: 10,
      rank: { tier: "lantern", step: 2 },
    });

    // Three more runs (one flagged, which does not count) and one more: the newest five are
    // 14, 30, 30, 12, 10 -> median 14 -> G_skill 3 (candle I).
    const later = [
      xpEntry({ deepestRoom: 30, rooms: 30, endedAt: at(-5 * HOUR_MS) }),
      xpEntry({ deepestRoom: 30, rooms: 30, endedAt: at(-4 * HOUR_MS) }),
      xpEntry({
        deepestRoom: 99,
        rooms: 99,
        durationSeconds: 10,
        endedAt: at(-3 * HOUR_MS),
      }),
      xpEntry({
        deepestRoom: 14,
        rooms: 14,
        endedAt: at(-2 * HOUR_MS),
        danger: 4,
      }),
    ];
    const upload = AddXpResponse.parse((await postXp(p.token, later)).json);
    expect(upload.entries.map((e) => e.status)).toEqual([
      "credited",
      "credited",
      "flagged",
      "credited",
    ]);
    // 14 rooms = 70, no record (30 was deeper), not the first run of the day; 70 · 20 % = 14.
    expect(upload.entries[3]?.breakdown).toMatchObject({
      danger: 4,
      dangerBonus: 14,
      total: 84,
    });
    const state = await getState(p.token);
    expect(state.recentRuns.map((r) => r.deepestRoom)).toEqual([
      14, 30, 30, 12, 10,
    ]);
    expect(state.recentRuns[0]).toMatchObject({
      runId: later[3]?.runId,
      danger: 4,
      endedAt: at(-2 * HOUR_MS),
    });
    expect(state).toMatchObject({
      danger: 3,
      rank: { tier: "candle", step: 1 },
    });
    expect(
      PlayerSelf.parse((await ctx.req("GET", "/me", { token: p.token })).json)
    ).toMatchObject({ danger: 3, rank: { tier: "candle", step: 1 } });
    const row = await ctx.db.xpEntry.findFirstOrThrow({
      where: { runId: later[3]?.runId },
    });
    expect(row.danger).toBe(4);
  });

  it("shows danger level and rank on guild members and the leaderboards (dangerRank)", async () => {
    const p = await ctx.login("Rangprobe");
    await setLevel(p.id, 9);
    const guild = await ctx.req("POST", "/guilds", {
      token: p.token,
      body: { name: "Ranggilde", tag: "RNG" },
    });
    expect(guild.status).toBe(201);
    expect(GuildDetail.parse(guild.json).members[0]).toMatchObject({
      level: 9,
      danger: 4,
      rank: { tier: "candle", step: 2 },
    });

    expect(
      (await ctx.reportRun(p.token, { participants: [p.id] })).status
    ).toBe(201);
    const board = LeaderboardResponse.parse(
      (await ctx.req("GET", "/leaderboards/solo", { token: p.token })).json
    );
    expect(board.own).toMatchObject({
      level: 9,
      danger: 4,
      dangerRank: { tier: "candle", step: 2 },
    });
    const guildBoard = LeaderboardResponse.parse(
      (await ctx.req("GET", "/leaderboards/guild")).json
    );
    for (const e of guildBoard.entries) {
      expect(e.danger).toBeNull();
      expect(e.dangerRank).toBeNull();
    }
  });

  it("merging keeps the build changed later and unites the seen flags", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    await setLevel(a.id, 5);
    await setLevel(b.id, 5);
    await put(a.token, {
      talents: { ember_vitality: 4 },
      spells: ["light_flash"],
      changedAt: at(-HOUR_MS),
      seen: ["explain.forge"],
    });
    await put(b.token, {
      talents: { wind_light_foot: 2 },
      spells: [],
      changedAt: at(-3 * HOUR_MS),
      seen: ["explain.trader"],
    });
    // b is older and stays; a's build is newer and wins.
    await ctx.db.player.update({
      where: { id: b.id },
      data: { createdAt: new Date(NOON - 10 * DAY_MS) },
    });
    const code = (await ctx.req("POST", "/me/link-code", { token: b.token }))
      .json.code as string;
    const merged = await ctx.req("POST", "/me/link", {
      token: a.token,
      body: { code, confirmMerge: true },
    });
    expect(merged.status).toBe(200);
    expect(merged.json.player.id).toBe(b.id);
    const state = await getState(merged.json.token as string);
    expect(state).toMatchObject({
      talents: { ember_vitality: 4 },
      spells: ["light_flash"],
      changedAt: at(-HOUR_MS),
      seen: ["explain.forge", "explain.trader"],
    });
    expect(await ctx.db.accountState.count({ where: { playerId: a.id } })).toBe(
      0
    );
  });

  it("merging an account without state into one with state keeps it unchanged", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    await setLevel(b.id, 3);
    await put(b.token, {
      talents: { ember_vitality: 2 },
      spells: [],
      changedAt: at(-HOUR_MS),
      seen: ["explain.forge"],
    });
    // a is empty: absorbed into b without a question.
    const code = (await ctx.req("POST", "/me/link-code", { token: b.token }))
      .json.code as string;
    const res = await ctx.req("POST", "/me/link", {
      token: a.token,
      body: { code },
    });
    expect(res.status).toBe(200);
    expect(await getState(b.token)).toMatchObject({
      talents: { ember_vitality: 2 },
      seen: ["explain.forge"],
    });
  });

  it("deleting the account deletes its state", async () => {
    const p = await ctx.login();
    await put(p.token, { seen: ["explain.forge"] });
    expect(await ctx.db.accountState.count({ where: { playerId: p.id } })).toBe(
      1
    );
    expect((await ctx.req("DELETE", "/me", { token: p.token })).status).toBe(
      204
    );
    expect(await ctx.db.accountState.count({ where: { playerId: p.id } })).toBe(
      0
    );
  });
});
