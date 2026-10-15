import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_SECONDS,
} from "@soulwick/contracts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

const CODE_PATTERN = new RegExp(
  `^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`
);
const DAY_MS = 86_400_000;

describe("identities and account linking (P15, D-121, D-122)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  /** Dev login with a known device id, so the test can log in again through it. */
  async function device(name: string) {
    const deviceId = randomUUID();
    const res = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name, deviceId },
    });
    expect(res.status).toBe(200);
    return {
      deviceId,
      id: res.json.player.id as string,
      token: res.json.token as string,
    };
  }

  const loginAgain = (deviceId: string, name = "Egal") =>
    ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name, deviceId },
    });

  async function setCreatedAt(playerId: string, daysAgo: number) {
    await ctx.db.player.update({
      where: { id: playerId },
      data: { createdAt: new Date(Date.now() - daysAgo * DAY_MS) },
    });
  }

  async function linkCode(token: string): Promise<string> {
    const res = await ctx.req("POST", "/me/link-code", { token });
    expect(res.status).toBe(201);
    return res.json.code as string;
  }

  const link = (token: string, code: string, confirmMerge?: boolean) =>
    ctx.req("POST", "/me/link", {
      token,
      body: confirmMerge === undefined ? { code } : { code, confirmMerge },
    });

  async function createGuild(token: string, name: string, tag: string) {
    const res = await ctx.req("POST", "/guilds", {
      token,
      body: { name, tag },
    });
    expect(res.status).toBe(201);
    return res.json as { id: string; inviteCode: string };
  }

  async function join(token: string, inviteCode: string) {
    const res = await ctx.req("POST", "/guilds/join", {
      token,
      body: { inviteCode },
    });
    expect(res.status).toBe(200);
  }

  describe("GET /me/identities", () => {
    it("lists the providers with masked ids only", async () => {
      const p = await device("Maske");
      await ctx.db.playerIdentity.create({
        data: {
          playerId: p.id,
          provider: "steam",
          providerUserId: "76561190000000555",
        },
      });
      const res = await ctx.req("GET", "/me/identities", { token: p.token });
      expect(res.status).toBe(200);
      expect(res.json.items).toEqual([
        expect.objectContaining({
          provider: "device",
          maskedId: `***${p.deviceId.slice(-4)}`,
        }),
        expect.objectContaining({ provider: "steam", maskedId: "***0555" }),
      ]);
      const text = JSON.stringify(res.json);
      expect(text).not.toContain(p.deviceId);
      expect(text).not.toContain("76561190000000555");
      expect((await ctx.req("GET", "/me/identities")).status).toBe(401);
    });
  });

  describe("POST /me/link-code", () => {
    it("creates a 6-character code valid for 10 minutes; a new code replaces the old one", async () => {
      const p = await device("Codierer");
      const before = Date.now();
      const first = await ctx.req("POST", "/me/link-code", { token: p.token });
      expect(first.status).toBe(201);
      expect(first.json.code).toMatch(CODE_PATTERN);
      const expires = new Date(first.json.expiresAt).getTime();
      expect(expires).toBeGreaterThanOrEqual(
        before + LINK_CODE_TTL_SECONDS * 1000 - 1000
      );
      expect(expires).toBeLessThanOrEqual(
        Date.now() + LINK_CODE_TTL_SECONDS * 1000 + 1000
      );

      const second = await linkCode(p.token);
      expect(await ctx.db.linkCode.count({ where: { playerId: p.id } })).toBe(
        1
      );
      const stored = await ctx.db.linkCode.findUniqueOrThrow({
        where: { playerId: p.id },
      });
      expect(stored.codeHash).not.toContain(second);

      const other = await device("Andere");
      if (first.json.code !== second) {
        const old = await link(other.token, first.json.code);
        expect(old.status).toBe(404);
        expect(old.json.error).toBe("link_code_not_found");
      }
    });
  });

  describe("POST /me/link", () => {
    it("unknown, expired and own codes are rejected", async () => {
      const a = await device("Eigner");
      const b = await device("Zweitgeraet");
      const unknown = await link(b.token, "ABCDEF");
      expect(unknown.status).toBe(404);
      expect(unknown.json.error).toBe("link_code_not_found");

      const invalid = await link(b.token, "0O1IL0");
      expect(invalid.status).toBe(400);
      expect(invalid.json.error).toBe("validation_error");

      const code = await linkCode(a.token);
      const own = await link(a.token, code.toLowerCase());
      expect(own.status).toBe(409);
      expect(own.json.error).toBe("already_linked");

      await ctx.db.linkCode.update({
        where: { playerId: a.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await link(b.token, code);
      expect(expired.status).toBe(410);
      expect(expired.json.error).toBe("link_code_expired");
      expect(await ctx.db.player.count({ where: { id: b.id } })).toBe(1);
    });

    it("an empty second account is absorbed silently into the code owner", async () => {
      const a = await device("Hauptkonto");
      await setCreatedAt(a.id, 1);
      await ctx.reportRun(a.token, { participants: [a.id] });
      const b = await device("Neues Handy");

      const res = await link(b.token, await linkCode(a.token));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        merged: false,
        removedPlayerId: b.id,
        player: { id: a.id, name: "Hauptkonto" },
      });
      expect(
        res.json.identities.map((i: { provider: string }) => i.provider)
      ).toEqual(["device", "device"]);

      expect(await ctx.db.player.count({ where: { id: b.id } })).toBe(0);
      expect(await ctx.db.linkCode.count({ where: { playerId: a.id } })).toBe(
        0
      );
      // The removed account's token is dead; its device lands on the remaining account.
      expect((await ctx.req("GET", "/me", { token: b.token })).status).toBe(
        401
      );
      const again = await loginAgain(b.deviceId);
      expect(again.json.player.id).toBe(a.id);
      // The new token works.
      const me = await ctx.req("GET", "/me", { token: res.json.token });
      expect(me.json.id).toBe(a.id);
    });

    it("an empty code owner is absorbed into a caller with progress", async () => {
      const a = await device("Leeres Konto");
      await setCreatedAt(a.id, 10);
      const b = await device("Fortschritt");
      await ctx.reportRun(b.token, { participants: [b.id] });

      const res = await link(b.token, await linkCode(a.token));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        merged: false,
        removedPlayerId: a.id,
        player: { id: b.id, name: "Fortschritt" },
      });
      expect((await loginAgain(a.deviceId)).json.player.id).toBe(b.id);
    });

    it("two accounts with progress need confirmMerge; the older one remains with everything", async () => {
      const older = await device("Altes Konto");
      await setCreatedAt(older.id, 30);
      const newer = await device("Neues Konto");
      await setCreatedAt(newer.id, 2);
      // Shared run (both took part) plus one own run each.
      await ctx.reportRun(older.token, {
        mode: "quick",
        participants: [older.id, newer.id],
        seed: "shared",
      });
      await ctx.reportRun(older.token, { participants: [older.id] });
      await ctx.reportRun(newer.token, { participants: [newer.id], seed: "x" });
      await ctx.db.playerIdentity.create({
        data: {
          playerId: newer.id,
          provider: "steam",
          providerUserId: "76561190000000777",
        },
      });

      // The newer account creates the code, the older one redeems it.
      const code = await linkCode(newer.token);
      const conflict = await link(older.token, code);
      expect(conflict.status).toBe(409);
      expect(conflict.json).toMatchObject({
        error: "account_has_progress",
        remaining: { id: older.id, name: "Altes Konto", runCount: 2 },
        removed: {
          id: newer.id,
          name: "Neues Konto",
          runCount: 2,
          providers: ["device", "steam"],
        },
      });
      // Nothing happened, the code still works.
      expect(await ctx.db.player.count({ where: { id: newer.id } })).toBe(1);

      const merged = await link(older.token, code, true);
      expect(merged.status).toBe(200);
      expect(merged.json).toMatchObject({
        merged: true,
        removedPlayerId: newer.id,
        player: {
          id: older.id,
          name: "Altes Konto",
          steamId: "76561190000000777",
        },
      });
      expect(await ctx.db.player.count({ where: { id: newer.id } })).toBe(0);
      expect(
        await ctx.db.runPlayer.count({ where: { playerId: older.id } })
      ).toBe(3);
      expect(await ctx.db.run.count({ where: { reportedBy: older.id } })).toBe(
        3
      );
      expect((await loginAgain(newer.deviceId)).json.player.id).toBe(older.id);
    });

    it("guild: the remaining account keeps its guild; the removed founder's guild gets a new founder (P-102)", async () => {
      const keep = await device("Gildenbleiber");
      await setCreatedAt(keep.id, 20);
      await createGuild(keep.token, "Bleibende Gilde", "BLEIB");

      const drop = await device("Gruender");
      const dropGuild = await createGuild(
        drop.token,
        "Verlassene Gilde",
        "VERL"
      );
      const member = await device("Mitglied");
      await join(member.token, dropGuild.inviteCode);

      const conflict = await link(drop.token, await linkCode(keep.token));
      expect(conflict.status).toBe(409);
      const res = await link(drop.token, await linkCode(keep.token), true);
      expect(res.status).toBe(200);
      expect(res.json.player.guild).toMatchObject({
        tag: "BLEIB",
        role: "founder",
      });

      const guild = await ctx.db.guild.findUniqueOrThrow({
        where: { id: dropGuild.id },
      });
      expect(guild.founderId).toBe(member.id);
      expect(guild.disbandedAt).toBeNull();
      const roles = await ctx.db.guildMember.findMany({
        where: { guildId: dropGuild.id },
      });
      expect(roles).toEqual([
        expect.objectContaining({ playerId: member.id, role: "founder" }),
      ]);
    });

    it("guild: a guildless remaining account takes over the other's membership and founder role", async () => {
      const keep = await device("Gildenlos");
      await setCreatedAt(keep.id, 20);
      await ctx.reportRun(keep.token, { participants: [keep.id] });
      const drop = await device("Gildengruender");
      const g = await createGuild(drop.token, "Uebernommene Gilde", "UEBER");

      const res = await link(keep.token, await linkCode(drop.token), true);
      expect(res.status).toBe(200);
      expect(res.json.removedPlayerId).toBe(drop.id);
      expect(res.json.player.guild).toMatchObject({
        id: g.id,
        role: "founder",
      });
      const guild = await ctx.db.guild.findUniqueOrThrow({
        where: { id: g.id },
      });
      expect(guild.founderId).toBe(keep.id);
    });

    it("refuses to link when either account is banned", async () => {
      const a = await device("Gesperrt");
      const code = await linkCode(a.token);
      await ctx.db.ban.create({ data: { playerId: a.id, reason: "Test" } });
      const b = await device("Unbeteiligt");
      const res = await link(b.token, code);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe("merge_blocked_banned");
      expect(
        await ctx.db.player.count({ where: { id: { in: [a.id, b.id] } } })
      ).toBe(2);
    });
  });

  describe("DELETE /me/identities/:provider", () => {
    it("unlinks a provider, never the last identity", async () => {
      const p = await device("Entkoppler");
      const last = await ctx.req("DELETE", "/me/identities/device", {
        token: p.token,
      });
      expect(last.status).toBe(409);
      expect(last.json.error).toBe("last_identity");

      const missing = await ctx.req("DELETE", "/me/identities/steam", {
        token: p.token,
      });
      expect(missing.status).toBe(404);
      expect(missing.json.error).toBe("identity_not_found");

      const unknown = await ctx.req("DELETE", "/me/identities/myspace", {
        token: p.token,
      });
      expect(unknown.status).toBe(404);

      await ctx.db.playerIdentity.create({
        data: {
          playerId: p.id,
          provider: "steam",
          providerUserId: "76561190000000888",
        },
      });
      const ok = await ctx.req("DELETE", "/me/identities/device", {
        token: p.token,
      });
      expect(ok.status).toBe(200);
      expect(ok.json.items).toEqual([
        expect.objectContaining({ provider: "steam" }),
      ]);
      // The unlinked device now gets a fresh account.
      const fresh = await loginAgain(p.deviceId);
      expect(fresh.json.player.id).not.toBe(p.id);
    });
  });
});
