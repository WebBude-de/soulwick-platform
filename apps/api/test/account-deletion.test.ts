import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AccountDeletionVerifyResponse,
  AdminAccountDeletionList,
  DELETION_CODE_MAX_ATTEMPTS,
  DELETION_CODE_TTL_SECONDS,
  DELETION_TOKEN_TTL_SECONDS,
  DeletionCodeResponse,
} from "@soulwick/contracts";
import { hmacSecret } from "../src/lib/secrets.ts";
import { signDeletionToken } from "../src/lib/tokens.ts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

describe("automatic account deletion (P-026)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  /** Dev login with a known device id, so the test can check the identity afterwards. */
  async function device(name: string) {
    const deviceId = `device-${randomUUID()}`;
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

  async function deletionCode(token: string): Promise<string> {
    const res = await ctx.req("POST", "/me/deletion-code", { token });
    expect(res.status).toBe(201);
    return DeletionCodeResponse.parse(res.json).code;
  }

  const verify = (playerName: string, code: string) =>
    ctx.req("POST", "/account-deletion/verify", { body: { playerName, code } });

  const confirm = (token: string) =>
    ctx.req("POST", "/account-deletion/confirm", { body: { token } });

  /** Same answer for every failure: nothing tells whether the name exists. */
  function expectInvalidCode(res: { status: number; json: unknown }) {
    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      error: "invalid_deletion_code",
      message: "Player name and deletion code do not match",
    });
  }

  function expectInvalidToken(res: { status: number; json: any }) {
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("deletion_token_invalid");
  }

  it("POST /me/deletion-code creates a 15-minute code; a new one replaces the old", async () => {
    const p = await ctx.login("Codezieher");
    const before = Date.now();
    const res = await ctx.req("POST", "/me/deletion-code", { token: p.token });
    expect(res.status).toBe(201);
    const body = DeletionCodeResponse.parse(res.json);
    expect(body.code).toMatch(CODE_PATTERN);
    const ttl = Date.parse(body.expiresAt) - before;
    expect(ttl).toBeGreaterThan(DELETION_CODE_TTL_SECONDS * 1000 - 5000);
    expect(ttl).toBeLessThanOrEqual(DELETION_CODE_TTL_SECONDS * 1000 + 1000);

    // Only the HMAC is stored.
    const row = await ctx.db.deletionCode.findUniqueOrThrow({
      where: { playerId: p.id },
    });
    expect(row.codeHash).not.toContain(body.code);

    const second = await deletionCode(p.token);
    expect(second).not.toBe(body.code);
    expect(await ctx.db.deletionCode.count({ where: { playerId: p.id } })).toBe(
      1
    );
    expectInvalidCode(await verify("Codezieher", body.code));
    expect((await verify("Codezieher", second)).status).toBe(200);

    // The fixed-code route of P-022 is gone; login required.
    expect(
      (await ctx.req("GET", "/me/deletion-code", { token: p.token })).status
    ).toBe(404);
    expect((await ctx.req("POST", "/me/deletion-code")).status).toBe(401);
  });

  it("verify answers wrong name, wrong code, unknown name and bad input the same way", async () => {
    const p = await ctx.login("Pruefling");
    const code = await deletionCode(p.token);

    expectInvalidCode(await verify("Pruefling", "AAAAAAAA"));
    expectInvalidCode(await verify("Jemand Anderes", code));
    expectInvalidCode(await verify("Gibtsnicht", "BBBBBBBB"));

    const invalid = await verify("x", code);
    expect(invalid.status).toBe(400);
    expect(invalid.json.error).toBe("validation_error");

    // Case-insensitive name, lower case code with dash and spaces.
    const ok = await verify(
      "pRUEFLING",
      ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `
    );
    expect(ok.status).toBe(200);
    const body = AccountDeletionVerifyResponse.parse(ok.json);
    expect(body.account).toEqual({
      playerName: "Pruefling",
      guild: null,
      guilds: [],
      runCount: 0,
      bugReportCount: 0,
    });
    const ttl = Date.parse(body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(DELETION_TOKEN_TTL_SECONDS * 1000 - 5000);
    expect(ttl).toBeLessThanOrEqual(DELETION_TOKEN_TTL_SECONDS * 1000 + 1000);
    // The confirmation token is no player token.
    expect((await ctx.req("GET", "/me", { token: body.token })).status).toBe(
      401
    );
  });

  it("an expired code is rejected", async () => {
    const p = await ctx.login("Abgelaufen");
    const code = await deletionCode(p.token);
    await ctx.db.deletionCode.update({
      where: { playerId: p.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expectInvalidCode(await verify("Abgelaufen", code));
  });

  it(`burns the player's code after ${DELETION_CODE_MAX_ATTEMPTS} wrong attempts for the name`, async () => {
    const p = await ctx.login("Ratekoenig");
    const code = await deletionCode(p.token);
    for (let i = 0; i < DELETION_CODE_MAX_ATTEMPTS; i += 1) {
      expectInvalidCode(await verify("ratekoenig", "CCCCCCCC"));
    }
    expectInvalidCode(await verify("Ratekoenig", code));
    // A fresh code from the game works again.
    const fresh = await deletionCode(p.token);
    expect((await verify("Ratekoenig", fresh)).status).toBe(200);
  });

  it("confirm deletes like DELETE /me: identities, guild with founder hand-over, runs anonymised", async () => {
    const founder = await device("Loeschgruender");
    const officer = await ctx.login("Bleibender");
    const guild = await ctx.req("POST", "/guilds", {
      token: founder.token,
      body: { name: "Webloeschgilde", tag: "WEB1" },
    });
    expect(guild.status).toBe(201);
    const join = await ctx.req("POST", "/guilds/join", {
      token: officer.token,
      body: { inviteCode: guild.json.inviteCode },
    });
    expect(join.status).toBe(200);
    // A second guild where the player is a plain member (D-147): the preview lists the role.
    const other = await ctx.req("POST", "/guilds", {
      token: officer.token,
      body: { name: "Andere Gilde", tag: "WEB2" },
    });
    const joinOther = await ctx.req("POST", "/guilds/join", {
      token: founder.token,
      body: { inviteCode: other.json.inviteCode },
    });
    expect(joinOther.status).toBe(200);
    const run = await ctx.reportRun(founder.token, {
      mode: "quick",
      participants: [founder.id, officer.id],
    });
    expect(run.status).toBe(201);

    const code = await deletionCode(founder.token);
    const verified = await verify("Loeschgruender", code);
    expect(verified.status).toBe(200);
    expect(verified.json.account).toEqual({
      playerName: "Loeschgruender",
      guild: { name: "Webloeschgilde", tag: "WEB1" },
      guilds: [
        { name: "Webloeschgilde", tag: "WEB1", role: "founder" },
        { name: "Andere Gilde", tag: "WEB2", role: "member" },
      ],
      runCount: 1,
      bugReportCount: 0,
    });

    const logBefore = await ctx.db.accountDeletion.count({
      where: { channel: "web_code" },
    });
    const res = await confirm(verified.json.token);
    expect(res.status).toBe(200);
    expect(res.json.deleted).toBe(true);
    expect(Number.isNaN(Date.parse(res.json.deletedAt))).toBe(false);

    expect(
      await ctx.db.player.findUnique({ where: { id: founder.id } })
    ).toBeNull();
    expect(
      await ctx.db.playerIdentity.count({
        where: { providerUserId: founder.deviceId },
      })
    ).toBe(0);
    expect(
      await ctx.db.deletionCode.count({ where: { playerId: founder.id } })
    ).toBe(0);
    const remaining = await ctx.db.guild.findUniqueOrThrow({
      where: { id: guild.json.id },
    });
    expect(remaining.founderId).toBe(officer.id);
    expect(remaining.disbandedAt).toBeNull();
    const participants = await ctx.db.runPlayer.findMany({
      where: { runId: run.json.id },
      select: { playerId: true },
    });
    expect(participants).toEqual([{ playerId: officer.id }]);
    const runRow = await ctx.db.run.findUniqueOrThrow({
      where: { id: run.json.id },
    });
    expect(runRow.reportedBy).toBeNull();
    expect((await ctx.req("GET", "/me", { token: founder.token })).status).toBe(
      401
    );

    // Deletion log without personal data.
    const log = await ctx.db.accountDeletion.findMany({
      where: { channel: "web_code" },
      orderBy: { deletedAt: "desc" },
    });
    expect(log).toHaveLength(logBefore + 1);
    expect(log[0]?.wasBanned).toBe(false);
    expect(log[0]?.playerHash).toMatch(HASH_PATTERN);
    const dump = JSON.stringify(log[0]);
    for (const secret of [
      "Loeschgruender",
      founder.id,
      founder.deviceId,
      "WEB1",
    ]) {
      expect(dump).not.toContain(secret);
    }

    // The token and the code are used up.
    expectInvalidToken(await confirm(verified.json.token));
    expectInvalidCode(await verify("Loeschgruender", code));
  });

  it("rejects replaced, expired and forged confirmation tokens", async () => {
    const p = await ctx.login("Tokenpruefer");
    const code = await deletionCode(p.token);
    const first = await verify("Tokenpruefer", code);
    expect(first.status).toBe(200);

    // A new code in the game invalidates the token of the old one.
    const second = await deletionCode(p.token);
    expectInvalidToken(await confirm(first.json.token));

    // Expired: same code row, but issued long ago.
    const row = await ctx.db.deletionCode.findUniqueOrThrow({
      where: { playerId: p.id },
    });
    const expired = await signDeletionToken(
      p.id,
      row.id,
      hmacSecret(ctx.config),
      DELETION_TOKEN_TTL_SECONDS,
      new Date(Date.now() - (DELETION_TOKEN_TTL_SECONDS + 5) * 1000)
    );
    expectInvalidToken(await confirm(expired.token));
    // Signed with another secret, a player token, garbage.
    const foreign = await signDeletionToken(
      p.id,
      row.id,
      "another-secret-0123456789abcdef-xyz",
      DELETION_TOKEN_TTL_SECONDS,
      new Date()
    );
    expectInvalidToken(await confirm(foreign.token));
    expectInvalidToken(await confirm(p.token));
    expectInvalidToken(await confirm("not-a-token"));
    const empty = await ctx.req("POST", "/account-deletion/confirm", {
      body: {},
    });
    expect(empty.status).toBe(400);
    expect(empty.json.error).toBe("validation_error");

    expect(await ctx.db.player.findUnique({ where: { id: p.id } })).not.toBe(
      null
    );
    // The current code still works.
    const ok = await verify("Tokenpruefer", second);
    expect((await confirm(ok.json.token)).status).toBe(200);
  });

  it("deletes a banned account (privacy) and notes it in the log", async () => {
    const mod = await ctx.createAdmin("moderator");
    const p = await ctx.login("Gesperrtweb");
    const code = await deletionCode(p.token);
    const ban = await ctx.req("POST", `/admin/players/${p.id}/bans`, {
      token: mod.token,
      body: { reason: "Testsperre", durationDays: 7 },
    });
    expect(ban.status).toBe(201);
    // Banned players cannot fetch a new code or delete in the game (P-108) ...
    expect(
      (await ctx.req("POST", "/me/deletion-code", { token: p.token })).status
    ).toBe(403);
    // ... but a code from before the ban deletes the account.
    const verified = await verify("Gesperrtweb", code);
    expect(verified.status).toBe(200);
    expect((await confirm(verified.json.token)).status).toBe(200);
    expect(await ctx.db.player.findUnique({ where: { id: p.id } })).toBeNull();
    expect(
      await ctx.db.accountDeletion.count({
        where: { channel: "web_code", wasBanned: true },
      })
    ).toBe(1);
  });

  it("DELETE /me writes the log with channel in_game", async () => {
    const p = await ctx.login("Imspiel");
    const before = await ctx.db.accountDeletion.count({
      where: { channel: "in_game" },
    });
    expect((await ctx.req("DELETE", "/me", { token: p.token })).status).toBe(
      204
    );
    expect(
      await ctx.db.accountDeletion.count({ where: { channel: "in_game" } })
    ).toBe(before + 1);
  });

  it("GET /admin/account-deletions: read-only log with counts per channel", async () => {
    const mod = await ctx.createAdmin("moderator");
    const admin = await ctx.createAdmin("admin");
    const player = await ctx.login("Adminweg");
    expect(
      (
        await ctx.req("DELETE", `/admin/players/${player.id}`, {
          token: admin.token,
        })
      ).status
    ).toBe(200);
    // An old entry outside of the time filter below.
    await ctx.db.accountDeletion.create({
      data: { channel: "admin", deletedAt: new Date("2026-01-05T12:00:00Z") },
    });

    const all = await ctx.req("GET", "/admin/account-deletions", {
      token: mod.token,
    });
    expect(all.status).toBe(200);
    const list = AdminAccountDeletionList.parse(all.json);
    const total = await ctx.db.accountDeletion.count();
    expect(list.total).toBe(total);
    expect(list.counts.web_code + list.counts.in_game + list.counts.admin).toBe(
      total
    );
    expect(list.counts.admin).toBe(2);
    expect(Object.keys(list.items[0] ?? {}).sort()).toEqual([
      "channel",
      "deletedAt",
      "id",
      "wasBanned",
    ]);
    expect(JSON.stringify(all.json)).not.toContain("Adminweg");

    const filtered = AdminAccountDeletionList.parse(
      (
        await ctx.req(
          "GET",
          "/admin/account-deletions?channel=admin&from=2026-01-01&to=2026-01-31",
          { token: mod.token }
        )
      ).json
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.deletedAt).toBe("2026-01-05T12:00:00.000Z");
    // Counts follow the time range but not the channel filter.
    expect(filtered.counts).toEqual({ web_code: 0, in_game: 0, admin: 1 });

    // Support question: was this account deleted?
    const byId = AdminAccountDeletionList.parse(
      (
        await ctx.req("GET", `/admin/account-deletions?playerId=${player.id}`, {
          token: mod.token,
        })
      ).json
    );
    expect(byId.total).toBe(1);
    expect(byId.items[0]?.channel).toBe("admin");
    const unknown = await ctx.req(
      "GET",
      `/admin/account-deletions?playerId=${randomUUID()}`,
      { token: mod.token }
    );
    expect(unknown.json.total).toBe(0);

    const bad = await ctx.req("GET", "/admin/account-deletions?channel=mail", {
      token: mod.token,
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("validation_error");
    expect((await ctx.req("GET", "/admin/account-deletions")).status).toBe(401);
    const asPlayer = await ctx.login("Neugierig");
    expect(
      (
        await ctx.req("GET", "/admin/account-deletions", {
          token: asPlayer.token,
        })
      ).status
    ).toBe(401);
    // The old request routes are gone.
    expect(
      (await ctx.req("GET", "/admin/deletion-requests", { token: admin.token }))
        .status
    ).toBe(404);

    const stats = await ctx.req("GET", "/admin/stats", { token: mod.token });
    expect(stats.json.openDeletionRequests).toBe(0);
    expect(stats.json.deletions7d).toBe(total - 1);
  });
});

describe("account deletion rate limit (P-026)", () => {
  it("verify has its own limit per IP", async () => {
    const limited = await createTestContext({
      DELETION_REQUESTS_PER_HOUR: "2",
    });
    try {
      const send = () =>
        limited.req("POST", "/account-deletion/verify", {
          body: { playerName: "Flut", code: "AAAAAAAA" },
        });
      expect((await send()).status).toBe(400);
      expect((await send()).status).toBe(400);
      const third = await send();
      expect(third.status).toBe(429);
      expect(third.json.error).toBe("rate_limited");
      // The old public route is gone.
      expect(
        (
          await limited.req("POST", "/account-deletion-requests", {
            body: { playerName: "Flut" },
          })
        ).status
      ).toBe(404);
    } finally {
      await limited.close();
    }
  });
});
