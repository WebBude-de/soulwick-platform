import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AdminPlayerDetail,
  AuthResponse,
  GuildDetail,
  MAX_NAME_CHANGES,
  PlayerSelf,
} from "@soulwick/contracts";
import { runHousekeeping } from "../src/services/housekeeping.ts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

const HOUR_MS = 3_600_000;
/** Name of a new account without a name: four random digits. */
const DEFAULT_NAME = /^Spieler-\d{4}$/;
const EMBER = {
  character: "ember",
  colors: { hair: 2, outfit: 5, skin: 1, accent: 7 },
} as const;
const MOSS = { character: "moss", colors: { hair: 0, outfit: 0, skin: 3 } };

/** Account profile: one name and one character per account (P-034, D-152). */
describe("account profile", () => {
  let ctx: TestContext;
  /** Injectable clock: tests move it forward to leave the name change window. */
  let offsetMs = 0;
  beforeAll(async () => {
    ctx = await createTestContext(
      {},
      { now: () => new Date(Date.now() + offsetMs) }
    );
  });
  afterAll(() => ctx.close());

  const guest = (body: Record<string, unknown>) =>
    ctx.req("POST", "/auth/device", { body });
  const patchMe = (token: string, body: unknown) =>
    ctx.req("PATCH", "/me", { token, body });

  it("guest login without a name creates 'Spieler-1234'; the profile is only used on creation", async () => {
    const deviceId = randomUUID();
    const first = await guest({ deviceId });
    expect(first.status).toBe(200);
    const auth = AuthResponse.parse(first.json);
    expect(auth.player.name).toMatch(DEFAULT_NAME);
    expect(auth.player.appearance).toBeNull();

    const withProfile = await guest({
      deviceId: randomUUID(),
      name: "Glimmer",
      appearance: EMBER,
    });
    expect(withProfile.json.player).toMatchObject({
      name: "Glimmer",
      appearance: EMBER,
    });

    // Known device: name and appearance of the request are ignored.
    const again = await guest({ deviceId, name: "Anders", appearance: MOSS });
    expect(again.json.player.name).toBe(auth.player.name);
    expect(again.json.player.appearance).toBeNull();

    const dev = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { deviceId: randomUUID() },
    });
    expect(dev.status).toBe(200);
    expect(dev.json.player.name).toMatch(DEFAULT_NAME);

    const badAppearance = await guest({
      deviceId: randomUUID(),
      appearance: {
        character: "wick",
        colors: { hair: 8, outfit: 0, skin: 0 },
      },
    });
    expect(badAppearance.status).toBe(400);
  });

  it("PATCH /me sets name and appearance; null resets the appearance", async () => {
    const p = await ctx.login();
    const res = await patchMe(p.token, {
      name: "Neuer Name",
      appearance: EMBER,
    });
    expect(res.status).toBe(200);
    expect(PlayerSelf.parse(res.json)).toMatchObject({
      id: p.id,
      name: "Neuer Name",
      appearance: EMBER,
    });
    const me = await ctx.req("GET", "/me", { token: p.token });
    expect(me.json).toMatchObject({ name: "Neuer Name", appearance: EMBER });

    const onlyLook = await patchMe(p.token, { appearance: MOSS });
    expect(onlyLook.json).toMatchObject({
      name: "Neuer Name",
      appearance: MOSS,
    });
    const reset = await patchMe(p.token, { appearance: null });
    expect(reset.json.appearance).toBeNull();

    // Names are display names, not unique.
    const other = await ctx.login();
    expect((await patchMe(other.token, { name: "Neuer Name" })).status).toBe(
      200
    );

    // The relay token carries the new name.
    const jwt = await ctx.req("GET", "/auth/token", { token: p.token });
    const payload = JSON.parse(
      Buffer.from(jwt.json.token.split(".")[1], "base64url").toString("utf8")
    );
    expect(payload.name).toBe("Neuer Name");
  });

  it("400 validation_error for empty bodies, bad names and bad appearances", async () => {
    const p = await ctx.login();
    const cases: unknown[] = [
      {},
      { name: "x" },
      { name: "n".repeat(25) },
      { name: "Böse<script>" },
      {
        appearance: {
          character: "dragon",
          colors: { hair: 0, outfit: 0, skin: 0 },
        },
      },
      { appearance: { character: "wick", colors: { hair: 0, outfit: 0 } } },
      {
        appearance: {
          character: "wick",
          colors: { hair: -1, outfit: 0, skin: 0 },
        },
      },
      {
        appearance: {
          character: "wick",
          colors: { hair: 1.5, outfit: 0, skin: 0 },
        },
      },
    ];
    for (const body of cases) {
      const res = await patchMe(p.token, body);
      expect([res.status, res.json.error, body]).toEqual([
        400,
        "validation_error",
        body,
      ]);
    }
    expect(
      (await ctx.req("PATCH", "/me", { body: { name: "Ohne" } })).status
    ).toBe(401);
  });

  it("limits own renames per 24 h; same name and appearance do not count; admins are not limited", async () => {
    const p = await ctx.login("Start");
    for (let i = 1; i <= MAX_NAME_CHANGES; i += 1) {
      expect((await patchMe(p.token, { name: `Name ${i}` })).status).toBe(200);
    }
    // Unchanged name: no change, no count, no error.
    expect(
      (await patchMe(p.token, { name: `Name ${MAX_NAME_CHANGES}` })).status
    ).toBe(200);
    expect((await patchMe(p.token, { appearance: EMBER })).status).toBe(200);

    const limited = await ctx.app.request("/me", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${p.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Zu viel", appearance: MOSS }),
    });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as {
      error: string;
      retryAfter: number;
    };
    expect(body.error).toBe("name_change_limited");
    expect(body.retryAfter).toBeGreaterThan(23 * 3600);
    expect(Number(limited.headers.get("retry-after"))).toBe(body.retryAfter);
    // Nothing of the rejected request was applied.
    const me = await ctx.req("GET", "/me", { token: p.token });
    expect(me.json).toMatchObject({
      name: `Name ${MAX_NAME_CHANGES}`,
      appearance: EMBER,
    });

    const admin = await ctx.createAdmin("moderator");
    const renamed = await ctx.req("PATCH", `/admin/players/${p.id}`, {
      token: admin.token,
      body: { name: "Vom Admin" },
    });
    expect(renamed.status).toBe(200);

    const detail = AdminPlayerDetail.parse(
      (await ctx.req("GET", `/admin/players/${p.id}`, { token: admin.token }))
        .json
    );
    expect(detail.appearance).toEqual(EMBER);
    expect(detail.nameHistory?.[0]).toMatchObject({
      oldName: `Name ${MAX_NAME_CHANGES}`,
      newName: "Vom Admin",
      byAdmin: true,
    });
    expect(detail.nameHistory).toHaveLength(MAX_NAME_CHANGES + 1);
    expect(detail.nameHistory?.at(-1)).toMatchObject({
      oldName: "Start",
      newName: "Name 1",
      byAdmin: false,
    });

    // After the window the player may rename again.
    offsetMs = 25 * HOUR_MS;
    try {
      const later = await patchMe(p.token, { name: "Wieder frei" });
      expect(later.status).toBe(200);
    } finally {
      offsetMs = 0;
    }
  });

  it("guild member lists show the members' appearance", async () => {
    const founder = await ctx.login();
    await patchMe(founder.token, { appearance: EMBER });
    const created = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Profilgilde", tag: "PROF" },
    });
    expect(created.status).toBe(201);
    const member = await ctx.login();
    await ctx.req("POST", "/guilds/join", {
      token: member.token,
      body: { inviteCode: created.json.inviteCode },
    });
    const detail = GuildDetail.parse(
      (
        await ctx.req("GET", `/guilds/${created.json.id}`, {
          token: member.token,
        })
      ).json
    );
    const byId = new Map(detail.members.map((m) => [m.playerId, m]));
    expect(byId.get(founder.id)?.appearance).toEqual(EMBER);
    expect(byId.get(member.id)?.appearance).toBeNull();
  });

  it("banned players get 403 on PATCH /me", async () => {
    const p = await ctx.login();
    const mod = await ctx.createAdmin("moderator");
    await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Test", durationDays: 1 },
    });
    const res = await patchMe(p.token, { name: "Gesperrt" });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("banned");
  });

  it("housekeeping removes name changes after the retention period", async () => {
    const p = await ctx.login();
    await patchMe(p.token, { name: "Alt Name" });
    await ctx.db.playerNameChange.updateMany({
      where: { playerId: p.id },
      data: { changedAt: new Date(Date.now() - 91 * 24 * HOUR_MS) },
    });
    await patchMe(p.token, { name: "Neu Name" });
    await runHousekeeping({
      db: ctx.db,
      config: ctx.config,
      logger: { info: () => undefined, error: () => undefined },
    });
    const left = await ctx.db.playerNameChange.findMany({
      where: { playerId: p.id },
    });
    expect(left.map((r) => r.newName)).toEqual(["Neu Name"]);
  });
});
