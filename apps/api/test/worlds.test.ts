import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AccountHasProgressResponse,
  CloudWorld,
  MAX_CLOUD_WORLDS,
  PutWorldResponse,
  RestoreWorldResponse,
  WORLD_MAX_BODY_BYTES,
  WORLD_MAX_DATA_BYTES,
  WorldBackup,
  WorldBackupList,
  WorldConflictResponse,
  WorldLimitResponse,
  WorldList,
} from "@soulwick/contracts";
import { runHousekeeping } from "../src/services/housekeeping.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const silentLogger = { info: () => undefined, error: () => undefined };

/** Shared clock offset: the API's `now` (backups, archive, caps); sessions keep the wall clock. */
let offsetMs = 0;
const clock = () => new Date(Date.now() + offsetMs);

interface StateOpts {
  formatVersion?: number;
  gold?: number;
  lastPlayed?: Date;
  name?: string;
  playTime?: number;
  worldIdInData?: string;
}

/** A save file v5 as the game would send it (ConfigFile sections as JSON). */
function state(worldId: string, opts: StateOpts = {}) {
  const lastPlayed = opts.lastPlayed ?? clock();
  const formatVersion = opts.formatVersion ?? 5;
  const playTime = opts.playTime ?? 1200;
  return {
    formatVersion,
    gameVersion: "1.0.0",
    platform: "linux",
    summary: {
      name: opts.name ?? "Glutwald",
      deepestRoom: 12,
      forgeLevel: 4,
      forgeMax: 20,
      playTimeSeconds: playTime,
      lastPlayedAt: lastPlayed.toISOString(),
    },
    data: {
      meta: { version: formatVersion },
      world: {
        id: opts.worldIdInData ?? worldId,
        name: opts.name ?? "Glutwald",
      },
      progress: {
        permanent_gold: opts.gold ?? 100,
        unlocked: ["event_first_run"],
      },
      meta_upgrades: { max_hp: 2, damage: 1 },
      stats: { deepest_room: 12, play_time: playTime },
      profile: {
        created: Math.floor(lastPlayed.getTime() / 1000) - 3600,
        last_played: Math.floor(lastPlayed.getTime() / 1000),
      },
      cloud: { base_version: 3, dirty: true },
    },
  };
}

describe("cloud worlds (KF8, D-188, P-038)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({}, { now: clock });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(() => {
    offsetMs = 0;
  });

  /** Request with access to the response headers (ETag). */
  async function raw(
    method: string,
    path: string,
    opts: { token: string; body?: unknown; headers?: Record<string, string> }
  ) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${opts.token}`,
      ...opts.headers,
    };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const res = await ctx.app.request(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return {
      status: res.status,
      etag: res.headers.get("etag"),
      json: text ? JSON.parse(text) : null,
    };
  }

  const put = (
    token: string,
    worldId: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>
  ) => raw("PUT", `/me/worlds/${worldId}`, { token, body, headers });

  async function create(token: string, worldId: string, opts: StateOpts = {}) {
    const res = await put(token, worldId, {
      ...state(worldId, opts),
      baseRevision: 0,
    });
    expect(res.status).toBe(201);
    return PutWorldResponse.parse(res.json);
  }

  it("creates a world (201, ETag), lists it and returns the blob without the cloud section", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    const res = await put(
      p.token,
      worldId,
      state(worldId, { name: "Erste Welt" }),
      { "if-none-match": "*" }
    );
    expect(res.status).toBe(201);
    expect(res.etag).toBe('"1"');
    const body = PutWorldResponse.parse(res.json);
    expect(body.world).toMatchObject({
      worldId,
      revision: 1,
      status: "active",
      source: "upload",
      platform: "linux",
      backupCount: 0,
      pendingMerges: [],
      archivedAt: null,
    });
    expect(body.archived).toEqual([]);

    const list = WorldList.parse(
      (await ctx.req("GET", "/me/worlds", { token: p.token })).json
    );
    expect(list.items.map((w) => w.worldId)).toEqual([worldId]);
    expect(list.items[0]?.summary.name).toBe("Erste Welt");
    expect(list.archived).toEqual([]);
    expect(list.maxWorlds).toBe(MAX_CLOUD_WORLDS);
    expect(list.maxDataBytes).toBe(WORLD_MAX_DATA_BYTES);

    const got = await raw("GET", `/me/worlds/${worldId}`, { token: p.token });
    expect(got.status).toBe(200);
    expect(got.etag).toBe('"1"');
    const world = CloudWorld.parse(got.json);
    expect(world.data.cloud).toBeUndefined();
    expect(world.data.progress?.permanent_gold).toBe(100);
    expect(world.data.meta_upgrades).toEqual({ max_hp: 2, damage: 1 });
  });

  it("revision conflicts: stale base answers 409 with the server state", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    await create(p.token, worldId, { gold: 100 });

    // Base 0 again (second device that never synced): conflict with revision 1.
    const again = await put(p.token, worldId, {
      ...state(worldId, { gold: 5 }),
      baseRevision: 0,
    });
    expect(again.status).toBe(409);
    const conflict = WorldConflictResponse.parse(again.json);
    expect(conflict.world?.revision).toBe(1);
    expect(conflict.world?.data.progress?.permanent_gold).toBe(100);

    // Correct base via If-Match: revision 2.
    const ok = await put(p.token, worldId, state(worldId, { gold: 150 }), {
      "if-match": '"1"',
    });
    expect(ok.status).toBe(200);
    expect(ok.etag).toBe('"2"');

    // The other device still has base 1: conflict with revision 2 and its data.
    const stale = await put(p.token, worldId, {
      ...state(worldId, { gold: 7 }),
      baseRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.world.revision).toBe(2);
    expect(stale.json.world.data.progress.permanent_gold).toBe(150);

    // Unknown world with a base > 0: conflict without a server state.
    const unknown = randomUUID();
    const gone = await put(p.token, unknown, {
      ...state(unknown),
      baseRevision: 4,
    });
    expect(gone.status).toBe(409);
    expect(WorldConflictResponse.parse(gone.json).world).toBeNull();
  });

  it("base revision rules: required, If-Match readable and equal to baseRevision", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    const missing = await put(p.token, worldId, state(worldId));
    expect(missing.status).toBe(400);
    expect(missing.json.error).toBe("revision_required");

    const differ = await put(
      p.token,
      worldId,
      { ...state(worldId), baseRevision: 0 },
      { "if-match": '"3"' }
    );
    expect(differ.status).toBe(400);
    expect(differ.json.error).toBe("invalid_revision");

    const unreadable = await put(p.token, worldId, state(worldId), {
      "if-match": "*",
    });
    expect(unreadable.status).toBe(400);
    expect(unreadable.json.error).toBe("invalid_revision");
  });

  it("checks world id, format, size and the body limit", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    const wrongId = await put(p.token, worldId, {
      ...state(worldId, { worldIdInData: randomUUID() }),
      baseRevision: 0,
    });
    expect(wrongId.status).toBe(400);
    expect(wrongId.json.error).toBe("world_id_mismatch");

    const wrongFormat = state(worldId);
    wrongFormat.data.meta.version = 6;
    const format = await put(p.token, worldId, {
      ...wrongFormat,
      baseRevision: 0,
    });
    expect(format.status).toBe(400);
    expect(format.json.error).toBe("format_mismatch");

    const v4 = await put(p.token, worldId, {
      ...state(worldId, { formatVersion: 4 }),
      baseRevision: 0,
    });
    expect(v4.status).toBe(400);
    expect(v4.json.error).toBe("validation_error");

    const notUuid = await put(p.token, "slot-1", {
      ...state(worldId),
      baseRevision: 0,
    });
    expect(notUuid.status).toBe(404);

    const big = state(worldId);
    (big.data as Record<string, unknown>).seen = {
      ids: "x".repeat(WORLD_MAX_DATA_BYTES),
    };
    const tooLarge = await put(p.token, worldId, { ...big, baseRevision: 0 });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.json.error).toBe("world_too_large");

    const huge = state(worldId);
    (huge.data as Record<string, unknown>).seen = {
      ids: "x".repeat(WORLD_MAX_BODY_BYTES),
    };
    const body = await put(p.token, worldId, { ...huge, baseRevision: 0 });
    expect(body.status).toBe(413);
    expect(body.json.error).toBe("payload_too_large");

    const none = WorldList.parse(
      (await ctx.req("GET", "/me/worlds", { token: p.token })).json
    );
    expect(none.items).toEqual([]);
  });

  it("caps timestamps from the future to the server time", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    const future = new Date(Date.now() + 2 * DAY_MS);
    const before = Date.now();
    await create(p.token, worldId, { lastPlayed: future });
    const world = CloudWorld.parse(
      (await ctx.req("GET", `/me/worlds/${worldId}`, { token: p.token })).json
    );
    const lastPlayed = new Date(world.summary.lastPlayedAt).getTime();
    expect(lastPlayed).toBeGreaterThanOrEqual(before - 1000);
    expect(lastPlayed).toBeLessThan(future.getTime() - DAY_MS);
    const stored = world.data.profile?.last_played as number;
    expect(stored * 1000).toBeLessThan(future.getTime() - DAY_MS);
    expect(stored * 1000).toBeGreaterThanOrEqual(before - 1000);

    // Within the tolerance (2 minutes ahead) the value stays as sent.
    const other = randomUUID();
    const soon = new Date(Date.now() + 2 * MINUTE_MS);
    await create(p.token, other, { lastPlayed: soon });
    const kept = CloudWorld.parse(
      (await ctx.req("GET", `/me/worlds/${other}`, { token: p.token })).json
    );
    expect(kept.summary.lastPlayedAt).toBe(soon.toISOString());
  });

  it("keeps at most 3 active worlds: the least recently played goes to the archive", async () => {
    const p = await ctx.login();
    const ids: [string, string, string] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    for (const [i, id] of ids.entries()) {
      await create(p.token, id, {
        lastPlayed: new Date(Date.now() - (10 - i) * DAY_MS),
      });
    }
    // A fourth world played today pushes the oldest (ids[0]) out.
    const fourth = randomUUID();
    const added = await create(p.token, fourth);
    expect(added.world.status).toBe("active");
    expect(added.archived.map((w) => w.worldId)).toEqual([ids[0]]);
    expect(added.archived[0]?.status).toBe("archived");
    expect(added.archived[0]?.expiresAt).not.toBeNull();

    // A fifth world played long ago lands in the archive itself.
    const old = randomUUID();
    const oldRes = await create(p.token, old, {
      lastPlayed: new Date(Date.now() - 100 * DAY_MS),
    });
    expect(oldRes.world.status).toBe("archived");
    expect(oldRes.archived.map((w) => w.worldId)).toEqual([old]);

    const list = WorldList.parse(
      (await ctx.req("GET", "/me/worlds", { token: p.token })).json
    );
    expect(list.items.map((w) => w.worldId)).toEqual([fourth, ids[2], ids[1]]);
    expect(list.archived.map((w) => w.worldId).toSorted()).toEqual(
      [ids[0], old].toSorted()
    );

    // Played again on a device (current revision): back to active, the oldest active goes.
    const revived = await put(p.token, ids[0], {
      ...state(ids[0]),
      baseRevision: 1,
    });
    expect(revived.status).toBe(200);
    const revivedBody = PutWorldResponse.parse(revived.json);
    expect(revivedBody.world.status).toBe("active");
    expect(revivedBody.world.revision).toBe(2);
    expect(revivedBody.archived.map((w) => w.worldId)).toEqual([ids[1]]);
  });

  it("unarchive needs a free place or archiveWorldId", async () => {
    const p = await ctx.login();
    const active: [string, string, string] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    for (const id of active) {
      await create(p.token, id);
    }
    const archived = randomUUID();
    await create(p.token, archived, {
      lastPlayed: new Date(Date.now() - 50 * DAY_MS),
    });

    const full = await ctx.req("POST", `/me/worlds/${archived}/unarchive`, {
      token: p.token,
    });
    expect(full.status).toBe(409);
    expect(WorldLimitResponse.parse(full.json).items).toHaveLength(3);

    const invalid = await ctx.req("POST", `/me/worlds/${archived}/unarchive`, {
      token: p.token,
      body: { archiveWorldId: randomUUID() },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error).toBe("invalid_archive_world");

    const swap = await raw("POST", `/me/worlds/${archived}/unarchive`, {
      token: p.token,
      body: { archiveWorldId: active[1] },
    });
    expect(swap.status).toBe(200);
    expect(swap.etag).toBe('"1"');
    const body = RestoreWorldResponse.parse(swap.json);
    expect(body.world.status).toBe("active");
    expect(body.world.data.world?.id).toBe(archived);
    expect(body.archived.map((w) => w.worldId)).toEqual([active[1]]);

    // Already active: unchanged.
    const noop = await ctx.req("POST", `/me/worlds/${archived}/unarchive`, {
      token: p.token,
    });
    expect(noop.status).toBe(200);
    expect(noop.json.archived).toEqual([]);
  });

  it("keeps the discarded state of a merge as a backup and restores it as a new state", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    await create(p.token, worldId, { gold: 300 });

    // Merge on device B: the server state lost the "last played" fields.
    const merged = await put(p.token, worldId, {
      ...state(worldId, { gold: 40 }),
      baseRevision: 1,
      discarded: { side: "server" },
    });
    expect(merged.status).toBe(200);
    expect(merged.json.world.backupCount).toBe(1);

    // Next merge: the local state lost, the game sends it along.
    const local = state(worldId, { gold: 999, name: "Lokal" });
    const second = await put(p.token, worldId, {
      ...state(worldId, { gold: 50 }),
      baseRevision: 2,
      discarded: { ...local, side: "local" },
    });
    expect(second.status).toBe(200);

    const backups = WorldBackupList.parse(
      (
        await ctx.req("GET", `/me/worlds/${worldId}/backups`, {
          token: p.token,
        })
      ).json
    );
    expect(backups.items).toHaveLength(2);
    const [newest, oldest] = backups.items;
    expect(newest).toMatchObject({
      reason: "merge",
      fromRevision: null,
      pendingMerge: false,
    });
    expect(newest?.summary.name).toBe("Lokal");
    expect(oldest).toMatchObject({ reason: "merge", fromRevision: 1 });
    const backup = WorldBackup.parse(
      (
        await ctx.req("GET", `/me/worlds/${worldId}/backups/${oldest?.id}`, {
          token: p.token,
        })
      ).json
    );
    expect(backup.data.progress?.permanent_gold).toBe(300);
    expect(backup.data.cloud).toBeUndefined();

    // Restore the 300-gold state: revision 4, source restore, last played = server time.
    offsetMs = 3 * DAY_MS;
    const restored = await raw(
      "POST",
      `/me/worlds/${worldId}/backups/${oldest?.id}/restore`,
      { token: p.token }
    );
    expect(restored.status).toBe(200);
    expect(restored.etag).toBe('"4"');
    const body = RestoreWorldResponse.parse(restored.json);
    expect(body.world).toMatchObject({ revision: 4, source: "restore" });
    expect(body.world.data.progress?.permanent_gold).toBe(300);
    const restoredAt = clock().getTime();
    expect(
      Math.abs(new Date(body.world.summary.lastPlayedAt).getTime() - restoredAt)
    ).toBeLessThan(5000);
    expect(
      Math.abs(
        (body.world.data.profile?.last_played as number) * 1000 - restoredAt
      )
    ).toBeLessThan(5000);

    // The replaced state (50 gold) is a backup now; the restored backup stays.
    const after = WorldBackupList.parse(
      (
        await ctx.req("GET", `/me/worlds/${worldId}/backups`, {
          token: p.token,
        })
      ).json
    );
    expect(after.items.map((b) => b.reason)).toEqual([
      "restore",
      "merge",
      "merge",
    ]);
    expect(after.items[0]?.fromRevision).toBe(3);

    const unknown = await ctx.req(
      "POST",
      `/me/worlds/${worldId}/backups/${randomUUID()}/restore`,
      { token: p.token }
    );
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toBe("backup_not_found");
  });

  it("DELETE archives, permanent deletes, stale If-Match conflicts", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    await create(p.token, worldId);
    const stale = await raw("DELETE", `/me/worlds/${worldId}`, {
      token: p.token,
      headers: { "if-match": '"7"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.world.revision).toBe(1);

    const archived = await ctx.req("DELETE", `/me/worlds/${worldId}`, {
      token: p.token,
    });
    expect(archived.status).toBe(200);
    expect(archived.json.world.status).toBe("archived");
    const list = WorldList.parse(
      (await ctx.req("GET", "/me/worlds", { token: p.token })).json
    );
    expect(list.items).toEqual([]);
    expect(list.archived.map((w) => w.worldId)).toEqual([worldId]);

    const gone = await ctx.req(
      "DELETE",
      `/me/worlds/${worldId}?permanent=true`,
      { token: p.token }
    );
    expect(gone.status).toBe(204);
    const missing = await ctx.req("GET", `/me/worlds/${worldId}`, {
      token: p.token,
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("world_not_found");
    expect(
      await ctx.db.cloudWorldBackup.count({
        where: { world: { worldId } },
      })
    ).toBe(0);
  });

  it("worlds are per account; other players get 404, no token 401", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    const worldId = randomUUID();
    await create(a.token, worldId);
    const foreign = await ctx.req("GET", `/me/worlds/${worldId}`, {
      token: b.token,
    });
    expect(foreign.status).toBe(404);
    // The same world id on another account is a separate world (e.g. before linking).
    await create(b.token, worldId);
    expect((await ctx.req("GET", "/me/worlds")).status).toBe(401);
  });

  it("housekeeping deletes expired backups and archived worlds after 30 days", async () => {
    const p = await ctx.login();
    const kept = randomUUID();
    const archived = randomUUID();
    await create(p.token, kept);
    await put(p.token, kept, {
      ...state(kept),
      baseRevision: 1,
      discarded: { side: "server" },
    });
    await create(p.token, archived);
    await ctx.req("DELETE", `/me/worlds/${archived}`, { token: p.token });

    offsetMs = 29 * DAY_MS;
    const early = await runHousekeeping({
      db: ctx.db,
      config: ctx.config,
      logger: silentLogger,
      now: clock,
    });
    expect(await ctx.db.cloudWorld.count({ where: { playerId: p.id } })).toBe(
      2
    );
    expect(early).not.toBeNull();

    offsetMs = 31 * DAY_MS;
    // Reads already hide what expired, before the job ran.
    const hidden = WorldList.parse(
      (await ctx.req("GET", "/me/worlds", { token: p.token })).json
    );
    expect(hidden.archived).toEqual([]);
    expect(hidden.items[0]?.backupCount).toBe(0);

    const result = await runHousekeeping({
      db: ctx.db,
      config: ctx.config,
      logger: silentLogger,
      now: clock,
    });
    expect(result?.worldBackups).toBeGreaterThanOrEqual(1);
    expect(result?.worlds).toBeGreaterThanOrEqual(1);
    const rows = await ctx.db.cloudWorld.findMany({
      where: { playerId: p.id },
      select: { worldId: true },
    });
    expect(rows).toEqual([{ worldId: kept }]);
  });

  it("deleting the account deletes its worlds and backups", async () => {
    const p = await ctx.login();
    const worldId = randomUUID();
    await create(p.token, worldId);
    await put(p.token, worldId, {
      ...state(worldId),
      baseRevision: 1,
      discarded: { side: "server" },
    });
    expect((await ctx.req("DELETE", "/me", { token: p.token })).status).toBe(
      204
    );
    expect(await ctx.db.cloudWorld.count({ where: { playerId: p.id } })).toBe(
      0
    );
    const backups = await ctx.client.query(
      "select count(*)::int as n from cloud_world_backups b left join cloud_worlds w on w.id = b.cloud_world_id where w.id is null"
    );
    expect(backups.rows[0].n).toBe(0);
  });

  describe("account merge (D-122, D-188)", () => {
    async function linkCode(token: string): Promise<string> {
      const res = await ctx.req("POST", "/me/link-code", { token });
      expect(res.status).toBe(201);
      return res.json.code as string;
    }

    async function makeOlder(playerId: string, days: number) {
      await ctx.db.player.update({
        where: { id: playerId },
        data: { createdAt: new Date(Date.now() - days * DAY_MS) },
      });
    }

    it("a world under 5 minutes is no progress: the empty account merges without asking", async () => {
      const owner = await ctx.login();
      const caller = await ctx.login();
      await makeOlder(owner.id, 3);
      const worldId = randomUUID();
      await create(caller.token, worldId, { playTime: 120 });
      const code = await linkCode(owner.token);
      const res = await ctx.req("POST", "/me/link", {
        token: caller.token,
        body: { code },
      });
      expect(res.status).toBe(200);
      expect(res.json.merged).toBe(false);
      const list = WorldList.parse(
        (await ctx.req("GET", "/me/worlds", { token: res.json.token })).json
      );
      expect(list.items.map((w) => w.worldId)).toEqual([worldId]);
    });

    it("a played world is progress; merge joins equal ids, moves the rest and archives beyond 3", async () => {
      const owner = await ctx.login();
      const caller = await ctx.login();
      await makeOlder(owner.id, 10);
      const shared = randomUUID();
      const ownerOnly: [string, string] = [randomUUID(), randomUUID()];
      const callerOnly: [string, string] = [randomUUID(), randomUUID()];
      // Owner: shared world played 5 days ago with 100 gold, two own worlds 6 and 7 days ago.
      await create(owner.token, shared, {
        gold: 100,
        lastPlayed: new Date(Date.now() - 5 * DAY_MS),
      });
      await create(owner.token, ownerOnly[0], {
        lastPlayed: new Date(Date.now() - 6 * DAY_MS),
      });
      await create(owner.token, ownerOnly[1], {
        lastPlayed: new Date(Date.now() - 7 * DAY_MS),
      });
      // Caller: the shared world played today (wins "last played"), revision 2, two own worlds.
      await create(caller.token, shared, { gold: 10 });
      await put(caller.token, shared, {
        ...state(shared, { gold: 20 }),
        baseRevision: 1,
      });
      await create(caller.token, callerOnly[0], {
        lastPlayed: new Date(Date.now() - 1 * DAY_MS),
      });
      await create(caller.token, callerOnly[1], {
        lastPlayed: new Date(Date.now() - 9 * DAY_MS),
      });

      const code = await linkCode(owner.token);
      const ask = await ctx.req("POST", "/me/link", {
        token: caller.token,
        body: { code },
      });
      expect(ask.status).toBe(409);
      const summaries = AccountHasProgressResponse.parse(ask.json);
      expect(summaries.remaining.worlds).toBe(3);
      expect(summaries.removed.worlds).toBe(3);

      const res = await ctx.req("POST", "/me/link", {
        token: caller.token,
        body: { code, confirmMerge: true },
      });
      expect(res.status).toBe(200);
      expect(res.json.merged).toBe(true);
      const token = res.json.token as string;

      const list = WorldList.parse(
        (await ctx.req("GET", "/me/worlds", { token })).json
      );
      // Active by last played: shared (today), callerOnly[0] (1 day), ownerOnly[0] (6 days).
      expect(list.items.map((w) => w.worldId)).toEqual([
        shared,
        callerOnly[0],
        ownerOnly[0],
      ]);
      expect(list.archived.map((w) => w.worldId).toSorted()).toEqual(
        [ownerOnly[1], callerOnly[1]].toSorted()
      );

      const joined = list.items[0];
      expect(joined).toMatchObject({ revision: 3, source: "account_merge" });
      expect(joined?.pendingMerges).toHaveLength(1);
      const world = CloudWorld.parse(
        (await ctx.req("GET", `/me/worlds/${shared}`, { token })).json
      );
      expect(world.data.progress?.permanent_gold).toBe(20);

      // The game fetches the other state, merges it and clears the pending merge.
      const pendingId = joined?.pendingMerges[0] as string;
      const other = WorldBackup.parse(
        (
          await ctx.req("GET", `/me/worlds/${shared}/backups/${pendingId}`, {
            token,
          })
        ).json
      );
      expect(other).toMatchObject({
        reason: "account_merge",
        pendingMerge: true,
        fromRevision: 1,
      });
      expect(other.data.progress?.permanent_gold).toBe(100);
      // A device of the old owner account still has base 1: conflict shows the pending merge.
      const stale = await put(token, shared, {
        ...state(shared),
        baseRevision: 1,
      });
      expect(stale.status).toBe(409);
      expect(stale.json.world.pendingMerges).toEqual([pendingId]);

      const resolved = await put(token, shared, {
        ...state(shared, { gold: 20 }),
        baseRevision: 3,
        resolvedMerges: [pendingId],
      });
      expect(resolved.status).toBe(200);
      expect(resolved.json.world.pendingMerges).toEqual([]);
      expect(resolved.json.world.backupCount).toBe(1);
    });
  });
});

describe("cloud world rate limit", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ WORLD_WRITES_PER_HOUR: "2" });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("limits writes per account and hour (429 with Retry-After), reads stay open", async () => {
    const p = await ctx.login();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const worldId = randomUUID();
      const res = await ctx.req("PUT", `/me/worlds/${worldId}`, {
        token: p.token,
        body: { ...state(worldId), baseRevision: 0 },
      });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.json.error).toBe("rate_limited");
      }
    }
    expect(statuses).toEqual([201, 201, 429]);
    expect(
      (await ctx.req("GET", "/me/worlds", { token: p.token })).status
    ).toBe(200);
    // Another account has its own budget.
    const other = await ctx.login();
    const worldId = randomUUID();
    const res = await ctx.req("PUT", `/me/worlds/${worldId}`, {
      token: other.token,
      body: { ...state(worldId), baseRevision: 0 },
    });
    expect(res.status).toBe(201);
  });
});
