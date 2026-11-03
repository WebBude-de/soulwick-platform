import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { APPLE_TOKEN_URL } from "../src/services/apple.ts";
import {
  DISCORD_TOKEN_URL,
  DISCORD_USER_URL,
  GOOGLE_OAUTH_TOKEN_URL,
} from "../src/services/oauth.ts";
import { STEAM_OPENID_URL } from "../src/services/steam-openid.ts";
import { authIntegrityIssues } from "./auth-integrity.ts";
import { byUrl, fakeFetch, json, unsignedJwt } from "./fake-fetch.ts";
import { createTestContext, type TestContext } from "./helpers.ts";
import {
  browserFlow,
  completeFlow,
  confirmWebLogin,
  oauthStart,
  pollWebLogin,
  startWebLogin,
  webLoginInfo,
} from "./web-login-flow.ts";

const GOOGLE_CLIENT = "test-web-client.apps.googleusercontent.com";
const APPLE_SERVICES_ID = "test.soulwick.web";
const WEB = "http://web.test";
/** Link code alphabet without 0/O, 1/I/L. */
const CODE_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;
const USER_CODE_FORMAT =
  /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{3}$/;
/** Obviously fake ids. */
const STEAM_ID = "76561190000000077";
const DISCORD_ID = "100000000000000042";

const appleKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const APPLE_PEM = appleKey.privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();

const nowSeconds = () => Math.floor(Date.now() / 1000);

const googleToken = (sub: string, extra: Record<string, unknown> = {}) =>
  json({
    access_token: "ya29.test",
    id_token: unsignedJwt({
      iss: "https://accounts.google.com",
      aud: GOOGLE_CLIENT,
      sub,
      iat: nowSeconds(),
      exp: nowSeconds() + 3600,
      ...extra,
    }),
  });

const googleCode = () => ({ code: "google-auth-code" });

describe("web login from the game (KF5)", () => {
  const fake = fakeFetch();
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext(
      {
        WEB_URL: WEB,
        GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
        GOOGLE_CLIENT_SECRET: "test-google-secret",
        DISCORD_CLIENT_ID: "1234567890",
        DISCORD_CLIENT_SECRET: "test-discord-secret",
        APPLE_CLIENT_ID: APPLE_SERVICES_ID,
        APPLE_TEAM_ID: "TESTTEAM01",
        APPLE_KEY_ID: "TESTKEY001",
        APPLE_PRIVATE_KEY: APPLE_PEM.replaceAll("\n", "\\n"),
        STEAM_OPENID_ENABLED: "true",
      },
      { fetch: fake.fetch }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fake.state.calls = [];
  });

  it("lists the configured methods and starts a request with code, secrets, user code and page URL", async () => {
    const config = await ctx.req("GET", "/public/config");
    expect(config.json.loginMethods).toEqual([
      "device",
      "password",
      "google",
      "apple",
      "discord",
      "steam",
    ]);
    const req = await startWebLogin(ctx);
    expect(req.code).toMatch(CODE_FORMAT);
    expect(req.userCode).toMatch(USER_CODE_FORMAT);
    expect(req.url).toBe(`${WEB}/login/${req.code}#k=${req.browserSecret}`);
    expect(req.url).not.toContain(req.userCode.replace("-", ""));
    expect(req.pollSecret.length).toBeGreaterThan(30);
    expect((await pollWebLogin(ctx, req)).json).toEqual({ status: "pending" });
    const info = await webLoginInfo(ctx, req.code, {
      browserToken: req.browserToken,
    });
    expect(info.status).toBe(200);
    expect(info.json.authorized).toBe(true);
    expect(info.json.status).toBe("pending");
    expect(info.json.intent).toBe("sign_in");
    expect(info.json.methods).toEqual(["google", "apple", "discord", "steam"]);
    const formatted =
      `${req.code.slice(0, 4)}-${req.code.slice(4)}`.toLowerCase();
    expect(
      (await webLoginInfo(ctx, formatted, { browserToken: req.browserToken }))
        .json.authorized
    ).toBe(true);
    const wrong = await ctx.req("POST", "/auth/web-login/poll", {
      body: { code: req.code, pollSecret: "x".repeat(40) },
    });
    expect(wrong.status).toBe(404);
    expect(wrong.json.error).toBe("web_login_not_found");
  });

  it("Google: PKCE + state, waits for the typed code, then a new account, session collected once", async () => {
    const req = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () =>
        googleToken("google-sub-0001", { email: "player@example.org" }),
    });
    const flow = await browserFlow(ctx, "google", req, googleCode);
    expect(flow.providerUrl.origin + flow.providerUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(flow.providerUrl.searchParams.get("scope")).toBe("openid");
    expect(flow.providerUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3102/auth/oauth/google/callback"
    );
    expect(flow.back.origin + flow.back.pathname).toBe(
      `${WEB}/login/${req.code}`
    );
    const form = new URLSearchParams(fake.state.calls[0]?.body ?? "");
    expect(
      createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url")
    ).toBe(flow.providerUrl.searchParams.get("code_challenge") ?? "");

    // Proven, not finished: the page shows what confirming does.
    expect((await pollWebLogin(ctx, req)).json.status).toBe("awaiting_confirm");
    const page = await ctx.req(
      "GET",
      `/auth/web-login/${req.code}?confirm=${flow.confirmSecret}`
    );
    expect(page.json.status).toBe("awaiting_confirm");
    expect(page.json.newAccount).toBe(true);
    expect(page.json.attemptsLeft).toBe(5);

    const confirmed = await confirmWebLogin(
      ctx,
      req.code,
      flow.confirmSecret ?? "",
      req.userCode.toLowerCase()
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.status).toBe("completed");
    const collected = await pollWebLogin(ctx, req);
    expect(collected.json.status).toBe("completed");
    expect(collected.json.result).toBe("signed_in");
    expect(collected.json.provider).toBe("google");
    const me = await ctx.req("GET", "/me", {
      token: collected.json.auth.token,
    });
    expect(me.status).toBe(200);
    expect((await pollWebLogin(ctx, req)).json.status).toBe("expired");

    const user = await ctx.client.query(
      "select email from auth_users where player_id = $1",
      [me.json.id]
    );
    expect(user.rows[0].email).toEndWith("@players.soulwick.invalid");

    // Same Google account again: the page names the existing account, same player.
    const again = await startWebLogin(ctx);
    const second = await browserFlow(ctx, "google", again, googleCode);
    const preview = await ctx.req(
      "GET",
      `/auth/web-login/${again.code}?confirm=${second.confirmSecret}`
    );
    expect(preview.json.account).toEqual({ name: me.json.name, level: 1 });
    await confirmWebLogin(
      ctx,
      again.code,
      second.confirmSecret ?? "",
      again.userCode
    );
    expect((await pollWebLogin(ctx, again)).json.auth.player.id).toBe(
      me.json.id
    );
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("refuses callbacks without the binding cookie or with a used state", async () => {
    const req = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-0002"),
    });
    const noCookie = await browserFlow(ctx, "google", req, googleCode, {
      dropCookie: true,
    });
    expect(noCookie.back.toString()).toBe(`${WEB}/login?error=invalid_state`);
    expect(fake.state.calls).toHaveLength(0);

    const ok = await browserFlow(ctx, "google", req, googleCode);
    const replay = await ctx.app.request(
      `/auth/oauth/google/callback?state=${ok.providerUrl.searchParams.get("state")}&code=c`,
      { headers: { cookie: ok.cookie } }
    );
    expect(replay.headers.get("location")).toBe(
      `${WEB}/login?error=invalid_state`
    );
  });

  it("sends cancelled and provider errors back to the page; the request stays open", async () => {
    const req = await startWebLogin(ctx);
    const cancelled = await browserFlow(ctx, "google", req, () => ({
      error: "access_denied",
    }));
    expect(cancelled.back.searchParams.get("error")).toBe("cancelled");

    fake.state.handler = () => json({ error: "invalid_grant" }, 400);
    const rejected = await browserFlow(ctx, "google", req, googleCode);
    expect(rejected.back.searchParams.get("error")).toBe("invalid_oauth_code");

    fake.state.handler = () => new Response("down", { status: 503 });
    const down = await browserFlow(ctx, "google", req, googleCode);
    expect(down.back.searchParams.get("error")).toBe("provider_error");

    expect((await pollWebLogin(ctx, req)).json.status).toBe("pending");
  });

  it("Discord: identify scope only, the user id becomes the identity", async () => {
    const req = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [DISCORD_TOKEN_URL]: () => json({ access_token: "discord-access" }),
      [DISCORD_USER_URL]: (call) => {
        expect(call.headers.authorization).toBe("Bearer discord-access");
        return json({ id: DISCORD_ID, username: "ignored", email: "x@y.z" });
      },
    });
    const { flow, polled } = await completeFlow(ctx, "discord", req, () => ({
      code: "discord-code",
    }));
    expect(flow.providerUrl.searchParams.get("scope")).toBe("identify");
    expect(polled.json.provider).toBe("discord");
    const row = await ctx.client.query(
      `select a.account_id from player_identities i join auth_accounts a on a.id = i.auth_account_id
       where i.provider = 'discord'`
    );
    expect(row.rows[0].account_id).toBe(DISCORD_ID);
  });

  it("Apple on the web: signed client secret, refresh token stored encrypted for revocation", async () => {
    const req = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [APPLE_TOKEN_URL]: (call) => {
        const form = new URLSearchParams(call.body ?? "");
        const [h, p, s] = (form.get("client_secret") ?? "").split(".");
        expect(
          verify(
            "sha256",
            Buffer.from(`${h}.${p}`),
            { key: appleKey.publicKey, dsaEncoding: "ieee-p1363" },
            Buffer.from(s ?? "", "base64url")
          )
        ).toBe(true);
        const claims = JSON.parse(Buffer.from(p ?? "", "base64url").toString());
        expect(claims.sub).toBe(APPLE_SERVICES_ID);
        expect(claims.iss).toBe("TESTTEAM01");
        return json({
          id_token: unsignedJwt({
            iss: "https://appleid.apple.com",
            aud: APPLE_SERVICES_ID,
            sub: "apple-web-sub.0001",
            exp: nowSeconds() + 600,
          }),
          refresh_token: "apple-refresh-token-plain",
        });
      },
    });
    const { flow, polled } = await completeFlow(ctx, "apple", req, () => ({
      code: "apple-code",
    }));
    expect(flow.providerUrl.searchParams.get("response_mode")).toBe("query");
    expect(flow.providerUrl.searchParams.has("scope")).toBe(false);
    expect(polled.json.status).toBe("completed");
    const row = await ctx.client.query(
      "select refresh_token, client_id from auth_accounts where provider_id = 'apple'"
    );
    expect(row.rows[0].client_id).toBe(APPLE_SERVICES_ID);
    expect(row.rows[0].refresh_token).not.toContain("plain");
    expect(row.rows[0].refresh_token.length).toBeGreaterThan(20);
  });

  it("Steam OpenID: check_authentication at Steam, same identity as the ticket", async () => {
    const req = await startWebLogin(ctx);
    const answer = (providerUrl: URL) => {
      const returnTo = providerUrl.searchParams.get("openid.return_to") ?? "";
      const state = new URL(returnTo).searchParams.get("state") ?? "";
      return {
        state,
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "id_res",
        "openid.op_endpoint": STEAM_OPENID_URL,
        "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
        "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
        "openid.return_to": returnTo,
        "openid.response_nonce": "2026-11-03T12:00:00Zabc",
        "openid.assoc_handle": "1234567890",
        "openid.signed":
          "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
        "openid.sig": "c2lnbmF0dXJl",
      };
    };
    fake.state.handler = byUrl({
      [STEAM_OPENID_URL]: (call) => {
        const form = new URLSearchParams(call.body ?? "");
        expect(form.get("openid.mode")).toBe("check_authentication");
        expect(form.get("openid.sig")).toBe("c2lnbmF0dXJl");
        return new Response(
          "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"
        );
      },
    });
    const { flow, polled } = await completeFlow(ctx, "steam", req, answer);
    expect(flow.providerUrl.origin + flow.providerUrl.pathname).toBe(
      STEAM_OPENID_URL
    );
    expect(polled.json.provider).toBe("steam");
    const ids = await ctx.req("GET", "/me/identities", {
      token: polled.json.auth.token,
    });
    expect(ids.json.items[0].maskedId).toBe(`***${STEAM_ID.slice(-4)}`);

    const refused = await startWebLogin(ctx);
    fake.state.handler = () => new Response("is_valid:false\n");
    const bad = await browserFlow(ctx, "steam", refused, answer);
    expect(bad.back.searchParams.get("error")).toBe("invalid_steam_openid");
    const forged = await browserFlow(ctx, "steam", refused, (u) => ({
      ...answer(u),
      "openid.return_to": "http://evil.test/",
    }));
    expect(forged.back.searchParams.get("error")).toBe("invalid_steam_openid");
  });

  it("link: needs the session, adds the login to the game's account", async () => {
    const anonymous = await ctx.req("POST", "/auth/web-login", {
      body: { intent: "link" },
    });
    expect(anonymous.status).toBe(401);

    const guest = await ctx.login("Docht");
    const req = await startWebLogin(ctx, { token: guest.token, link: true });
    const info = await webLoginInfo(ctx, req.code, {
      browserToken: req.browserToken,
    });
    // The browser token shows no account data (only the proving browser sees it).
    expect(info.json.intent).toBe("link");
    expect(info.json.account).toBeNull();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-link-1"),
    });
    const { polled } = await completeFlow(ctx, "google", req, googleCode);
    expect(polled.json.status).toBe("completed");
    expect(polled.json.result).toBe("linked");
    expect(polled.json.removedPlayerId).toBeNull();
    expect(polled.json.auth.player.id).toBe(guest.id);
    const ids = await ctx.req("GET", "/me/identities", { token: guest.token });
    expect(
      ids.json.items.map((i: { provider: string }) => i.provider).sort()
    ).toEqual(["device", "google"]);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("link: an empty account with the login is absorbed after the confirmation", async () => {
    const first = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-empty"),
    });
    const empty = (await completeFlow(ctx, "google", first, googleCode)).polled
      .json.auth;

    const guest = await ctx.login();
    await ctx.reportRun(guest.token, { participants: [guest.id] });
    const req = await startWebLogin(ctx, { token: guest.token, link: true });
    const flow = await browserFlow(ctx, "google", req, googleCode);
    const page = await ctx.req(
      "GET",
      `/auth/web-login/${req.code}?confirm=${flow.confirmSecret}`
    );
    expect(page.json.merge.bothHaveProgress).toBe(false);
    expect(page.json.merge.removed.id).toBe(empty.player.id);
    await confirmWebLogin(
      ctx,
      req.code,
      flow.confirmSecret ?? "",
      req.userCode
    );
    const done = await pollWebLogin(ctx, req);
    expect(done.json.status).toBe("completed");
    expect(done.json.merged).toBe(false);
    expect(done.json.removedPlayerId).toBe(empty.player.id);
    expect(done.json.auth.player.id).toBe(guest.id);
    expect((await ctx.req("GET", "/me", { token: empty.token })).status).toBe(
      401
    );
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("link: two accounts with progress are merged in the same confirmation", async () => {
    const first = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-progress"),
    });
    const older = (await completeFlow(ctx, "google", first, googleCode)).polled
      .json.auth;
    await ctx.reportRun(older.token, { participants: [older.player.id] });

    const guest = await ctx.login("Jungspund");
    await ctx.reportRun(guest.token, { participants: [guest.id] });
    const req = await startWebLogin(ctx, { token: guest.token, link: true });
    const flow = await browserFlow(ctx, "google", req, googleCode);
    expect((await pollWebLogin(ctx, req)).json.status).toBe("awaiting_confirm");

    const withoutSecret = await ctx.req("GET", `/auth/web-login/${req.code}`);
    expect(withoutSecret.json.authorized).toBe(false);
    expect(withoutSecret.json.merge).toBeNull();
    const page = await ctx.req(
      "GET",
      `/auth/web-login/${req.code}?confirm=${flow.confirmSecret}`
    );
    expect(page.json.merge.bothHaveProgress).toBe(true);
    expect(page.json.merge.remaining.id).toBe(older.player.id);
    expect(page.json.merge.removed.id).toBe(guest.id);
    expect(page.json.account.name).toBe(older.player.name);

    const confirmed = await confirmWebLogin(
      ctx,
      req.code,
      flow.confirmSecret ?? "",
      req.userCode
    );
    expect(confirmed.json.status).toBe("completed");
    expect(confirmed.json.merged).toBe(true);
    const done = await pollWebLogin(ctx, req);
    expect(done.json.merged).toBe(true);
    expect(done.json.removedPlayerId).toBe(guest.id);
    expect(done.json.auth.player.id).toBe(older.player.id);
    expect((await ctx.req("GET", "/me", { token: guest.token })).status).toBe(
      401
    );
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("sign-in of a banned player fails with reason; finished requests refuse new flows", async () => {
    const first = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-banned"),
    });
    const player = (await completeFlow(ctx, "google", first, googleCode)).polled
      .json.auth.player;
    const admin = await ctx.createAdmin();
    await ctx.req("POST", `/admin/players/${player.id}/bans`, {
      token: admin.token,
      body: { reason: "Testsperre", durationDays: 7 },
    });

    const req = await startWebLogin(ctx);
    const { confirmed } = await completeFlow(ctx, "google", req, googleCode);
    expect(confirmed.json.ban.reason).toBe("Testsperre");
    const failed = await pollWebLogin(ctx, req);
    expect(failed.json.status).toBe("failed");
    expect(failed.json.error).toBe("banned");
    expect(failed.json.reason).toBe("Testsperre");
    expect(failed.json.expiresAt).toBeString();

    const again = await oauthStart(ctx, "google", req.code, req.browserToken);
    expect(new URL(again.headers.get("location") ?? "").search).toBe(
      "?error=web_login_not_pending"
    );
  });
});

describe("web login without providers", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ WEB_URL: WEB });
  });
  afterAll(() => ctx.close());

  it("redirects back with provider_not_configured and offers no methods", async () => {
    const req = await startWebLogin(ctx);
    const start = await oauthStart(ctx, "google", req.code, req.browserToken);
    expect(start.headers.get("location")).toBe(
      `${WEB}/login/${req.code}?error=provider_not_configured`
    );
    const info = await webLoginInfo(ctx, req.code, {
      browserToken: req.browserToken,
    });
    expect(info.json.methods).toEqual([]);
    const magic = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "someone@example.org",
        code: req.code,
        browserToken: req.browserToken,
      },
    });
    expect(magic.status).toBe(501);
    expect(magic.json.error).toBe("provider_not_configured");
  });

  it("expires requests after WEB_LOGIN_TTL_SECONDS", async () => {
    let clock = new Date();
    const timed = await createTestContext(
      { WEB_URL: WEB },
      { now: () => clock }
    );
    try {
      const req = await startWebLogin(timed);
      clock = new Date(clock.getTime() + 601_000);
      expect((await pollWebLogin(timed, req)).json).toEqual({
        status: "expired",
      });
    } finally {
      await timed.close();
    }
  });
});
