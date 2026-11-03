import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { STEAM_AUTH_URL } from "../src/services/steam.ts";
import { authIntegrityIssues } from "./auth-integrity.ts";
import { byUrl, type FakeCall, fakeFetch, json } from "./fake-fetch.ts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

const WORKER = "https://mail-worker.example.test/send";
const STEAM_ID = "76561190000000099";
const TICKET = "cafe".repeat(16);
const PASSWORD = "correct-horse-battery";
const TOKEN_IN_LINK = /\/login\/magic\?token=([\w-]+)/;

describe("add a login in the game (KF5, P-036 (2))", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  let lastMail = "";

  beforeAll(async () => {
    ctx = await createTestContext(
      {
        STEAM_WEB_API_KEY: "test-steam-publisher-key",
        STEAM_APP_ID: "4000001",
        MAIL_ADAPTER: "cloudflare",
        MAIL_FROM: "login@example.test",
        MAIL_CLOUDFLARE_URL: WORKER,
        MAIL_CLOUDFLARE_KEY: "test-mail-worker-key-0123456789abcdef",
      },
      { fetch: fake.fetch }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fake.state.handler = byUrl({
      [WORKER]: (call: FakeCall) => {
        lastMail = JSON.parse(call.body ?? "{}").text;
        return json({ ok: true });
      },
      [STEAM_AUTH_URL]: () =>
        json({ response: { params: { result: "OK", steamid: STEAM_ID } } }),
    });
  });

  /** Device login with a known device id (the proof for `provider: "device"`). */
  async function deviceLogin(name: string) {
    const deviceId = randomUUID();
    const res = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name, deviceId },
    });
    return {
      token: res.json.token as string,
      id: res.json.player.id as string,
      deviceId,
    };
  }

  async function addEmail(token: string, email: string) {
    const req = await ctx.req("POST", "/auth/web-login", {
      token,
      body: { intent: "link" },
    });
    await ctx.req("POST", "/auth/magic-link", {
      body: { email, code: req.json.code },
    });
    const link = lastMail.match(TOKEN_IN_LINK)?.[1];
    await ctx.req("POST", "/auth/magic-link/verify", { body: { token: link } });
    await ctx.req("POST", "/auth/web-login/poll", {
      body: { code: req.json.code, pollSecret: req.json.pollSecret },
    });
  }

  it("adds a Steam login with the ticket; the same ticket on the same account changes nothing", async () => {
    const guest = await ctx.login();
    const body = { provider: "steam", ticket: TICKET };
    const first = await ctx.req("POST", "/me/logins", {
      token: guest.token,
      body,
    });
    expect(first.status).toBe(200);
    expect(first.json.removedPlayerId).toBeNull();
    expect(first.json.merged).toBe(false);
    expect(first.json.player.steamId).toBe(STEAM_ID);
    expect(
      first.json.identities.map((i: { provider: string }) => i.provider).sort()
    ).toEqual(["device", "steam"]);
    const again = await ctx.req("POST", "/me/logins", {
      token: guest.token,
      body,
    });
    expect(again.status).toBe(200);
    expect(again.json.identities).toHaveLength(2);
    // The new token works, the old one too (same account).
    expect(
      (await ctx.req("GET", "/me", { token: first.json.token })).status
    ).toBe(200);
    expect((await ctx.req("GET", "/me", { token: guest.token })).status).toBe(
      200
    );
  });

  it("merges two accounts with progress only after confirmMerge; logins, hashes and e-mail move along", async () => {
    const older = await deviceLogin("Altkonto");
    await ctx.req("PUT", "/me/logins/password", {
      token: older.token,
      body: { username: "older-user", password: PASSWORD },
    });
    await ctx.reportRun(older.token, { participants: [older.id] });

    const newer = await deviceLogin("Neukonto");
    await ctx.req("PUT", "/me/logins/password", {
      token: newer.token,
      body: { username: "newer-user", password: PASSWORD },
    });
    await addEmail(newer.token, "newer@example.org");
    await ctx.reportRun(newer.token, { participants: [newer.id] });

    const body = { provider: "device", deviceId: older.deviceId };
    const ask = await ctx.req("POST", "/me/logins", {
      token: newer.token,
      body,
    });
    expect(ask.status).toBe(409);
    expect(ask.json.error).toBe("account_has_progress");
    expect(ask.json.remaining.id).toBe(older.id);
    expect(ask.json.removed.id).toBe(newer.id);

    const merged = await ctx.req("POST", "/me/logins", {
      token: newer.token,
      body: { ...body, confirmMerge: true },
    });
    expect(merged.status).toBe(200);
    expect(merged.json.merged).toBe(true);
    expect(merged.json.removedPlayerId).toBe(newer.id);
    expect(merged.json.player.id).toBe(older.id);
    expect((await ctx.req("GET", "/me", { token: newer.token })).status).toBe(
      401
    );

    for (const username of ["older-user", "newer-user"]) {
      const login = await ctx.req("POST", "/auth/password", {
        body: { username, password: PASSWORD },
      });
      expect(login.json.player.id).toBe(older.id);
    }
    const providers = merged.json.identities
      .map((i: { provider: string }) => i.provider)
      .sort();
    expect(providers).toEqual([
      "device",
      "device",
      "email",
      "password",
      "password",
    ]);
    const user = await ctx.client.query(
      "select email from auth_users where player_id = $1",
      [older.id]
    );
    expect(user.rows[0].email).toBe("newer@example.org");
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("keeps the remaining account's e-mail and drops the other one in a merge", async () => {
    const keep = await deviceLogin("Bleibt");
    await addEmail(keep.token, "keep@example.org");
    await ctx.reportRun(keep.token, { participants: [keep.id] });
    const drop = await deviceLogin("Geht");
    await addEmail(drop.token, "drop@example.org");
    await ctx.reportRun(drop.token, { participants: [drop.id] });

    const merged = await ctx.req("POST", "/me/logins", {
      token: drop.token,
      body: { provider: "device", deviceId: keep.deviceId, confirmMerge: true },
    });
    expect(merged.status).toBe(200);
    const emails = merged.json.identities.filter(
      (i: { provider: string }) => i.provider === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].label).toBe("ke***@example.org");
    const freed = await ctx.client.query(
      "select count(*)::int as n from auth_users where email = 'drop@example.org'"
    );
    expect(freed.rows[0].n).toBe(0);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("an empty caller account is absorbed: the device continues on the other account", async () => {
    const owner = await deviceLogin("Hauptkonto");
    await ctx.reportRun(owner.token, { participants: [owner.id] });
    const fresh = await deviceLogin("Neues Geraet");
    const res = await ctx.req("POST", "/me/logins", {
      token: fresh.token,
      body: { provider: "device", deviceId: owner.deviceId },
    });
    expect(res.status).toBe(200);
    expect(res.json.player.id).toBe(owner.id);
    expect(res.json.removedPlayerId).toBe(fresh.id);
    // The fresh device's own identity moved: it signs in to the main account now.
    const relogin = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { deviceId: fresh.deviceId },
    });
    expect(relogin.json.player.id).toBe(owner.id);
  });

  it("refuses merges with a banned account and unconfigured providers", async () => {
    const banned = await deviceLogin("Gesperrt");
    const admin = await ctx.createAdmin();
    await ctx.req("POST", `/admin/players/${banned.id}/bans`, {
      token: admin.token,
      body: { reason: "Testsperre", durationDays: null },
    });
    const me = await ctx.login();
    const blocked = await ctx.req("POST", "/me/logins", {
      token: me.token,
      body: { provider: "device", deviceId: banned.deviceId },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toBe("merge_blocked_banned");

    for (const body of [
      { provider: "google_play", serverAuthCode: "4/test-server-auth-code" },
      { provider: "apple", identityToken: "x".repeat(40) },
    ]) {
      const res = await ctx.req("POST", "/me/logins", {
        token: me.token,
        body,
      });
      expect(res.status).toBe(501);
      expect(res.json.error).toBe("provider_not_configured");
    }
    const invalid = await ctx.req("POST", "/me/logins", {
      token: me.token,
      body: { provider: "password", username: "x" },
    });
    expect(invalid.status).toBe(400);
    const anonymous = await ctx.req("POST", "/me/logins", {
      body: { provider: "steam", ticket: TICKET },
    });
    expect(anonymous.status).toBe(401);
  });
});
