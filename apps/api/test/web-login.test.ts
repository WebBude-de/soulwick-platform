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

const GOOGLE_CLIENT = "test-web-client.apps.googleusercontent.com";
const APPLE_SERVICES_ID = "test.soulwick.web";
const WEB = "http://web.test";
/** Link code alphabet without 0/O, 1/I/L. */
const CODE_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;
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

  async function startRequest(opts: { token?: string; link?: boolean } = {}) {
    const res = await ctx.req("POST", "/auth/web-login", {
      token: opts.token,
      body: opts.link ? { intent: "link" } : {},
    });
    expect(res.status).toBe(201);
    return res.json as { code: string; pollSecret: string; url: string };
  }

  const poll = (code: string, pollSecret: string) =>
    ctx.req("POST", "/auth/web-login/poll", { body: { code, pollSecret } });

  /** Runs start + callback like a browser; `answer` builds the provider's callback query. */
  async function browserFlow(
    provider: string,
    code: string,
    answer: (providerUrl: URL) => Record<string, string>,
    opts: { dropCookie?: boolean } = {}
  ) {
    const start = await ctx.app.request(
      `/auth/oauth/${provider}/start?code=${code}`
    );
    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get("location") ?? "");
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const query = new URLSearchParams(answer(providerUrl));
    const state = providerUrl.searchParams.get("state");
    if (state && !query.has("state")) {
      query.set("state", state);
    }
    const callback = await ctx.app.request(
      `/auth/oauth/${provider}/callback?${query}`,
      { headers: opts.dropCookie ? {} : { cookie } }
    );
    expect(callback.status).toBe(302);
    return {
      providerUrl,
      cookie,
      back: new URL(callback.headers.get("location") ?? ""),
    };
  }

  it("lists the configured methods and starts a request with code, poll secret and page URL", async () => {
    const config = await ctx.req("GET", "/public/config");
    expect(config.json.loginMethods).toEqual([
      "device",
      "password",
      "google",
      "apple",
      "discord",
      "steam",
    ]);
    const req = await startRequest();
    expect(req.code).toMatch(CODE_FORMAT);
    expect(req.url).toBe(`${WEB}/login/${req.code}`);
    expect(req.pollSecret.length).toBeGreaterThan(30);
    expect((await poll(req.code, req.pollSecret)).json).toEqual({
      status: "pending",
    });
    const info = await ctx.req("GET", `/auth/web-login/${req.code}`);
    expect(info.status).toBe(200);
    expect(info.json.status).toBe("pending");
    expect(info.json.intent).toBe("sign_in");
    expect(info.json.methods).toEqual(["google", "apple", "discord", "steam"]);
    // Formatted and lower-case input works for the code, a wrong poll secret does not.
    const formatted =
      `${req.code.slice(0, 4)}-${req.code.slice(4)}`.toLowerCase();
    expect((await ctx.req("GET", `/auth/web-login/${formatted}`)).status).toBe(
      200
    );
    const wrong = await poll(req.code, "x".repeat(40));
    expect(wrong.status).toBe(404);
    expect(wrong.json.error).toBe("web_login_not_found");
  });

  it("Google: PKCE + state, new account, session collected exactly once, no e-mail taken over", async () => {
    const req = await startRequest();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () =>
        googleToken("google-sub-0001", { email: "player@example.org" }),
    });
    const { providerUrl, back } = await browserFlow("google", req.code, () => ({
      code: "google-auth-code",
    }));
    expect(providerUrl.origin + providerUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(providerUrl.searchParams.get("scope")).toBe("openid");
    expect(providerUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3102/auth/oauth/google/callback"
    );
    expect(back.toString()).toBe(`${WEB}/login/${req.code}`);
    const tokenCall = fake.state.calls[0];
    const form = new URLSearchParams(tokenCall?.body ?? "");
    const verifier = form.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      providerUrl.searchParams.get("code_challenge") ?? ""
    );

    const collected = await poll(req.code, req.pollSecret);
    expect(collected.json.status).toBe("completed");
    expect(collected.json.result).toBe("signed_in");
    expect(collected.json.provider).toBe("google");
    const me = await ctx.req("GET", "/me", {
      token: collected.json.auth.token,
    });
    expect(me.status).toBe(200);
    expect((await poll(req.code, req.pollSecret)).json.status).toBe("expired");

    const user = await ctx.client.query(
      "select email from auth_users where player_id = $1",
      [me.json.id]
    );
    expect(user.rows[0].email).toEndWith("@players.soulwick.invalid");
    const ids = await ctx.req("GET", "/me/identities", {
      token: collected.json.auth.token,
    });
    expect(ids.json.items.map((i: { provider: string }) => i.provider)).toEqual(
      ["google"]
    );

    // Same Google account again: same player.
    const again = await startRequest();
    await browserFlow("google", again.code, () => ({ code: "code-2" }));
    const second = await poll(again.code, again.pollSecret);
    expect(second.json.auth.player.id).toBe(me.json.id);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("refuses callbacks without the binding cookie or with a used state", async () => {
    const req = await startRequest();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-0002"),
    });
    const noCookie = await browserFlow(
      "google",
      req.code,
      () => ({ code: "c" }),
      { dropCookie: true }
    );
    expect(noCookie.back.toString()).toBe(`${WEB}/login?error=invalid_state`);
    expect(fake.state.calls).toHaveLength(0);

    const ok = await browserFlow("google", req.code, () => ({ code: "c" }));
    const replay = await ctx.app.request(
      `/auth/oauth/google/callback?state=${ok.providerUrl.searchParams.get("state")}&code=c`,
      { headers: { cookie: ok.cookie } }
    );
    expect(replay.headers.get("location")).toBe(
      `${WEB}/login?error=invalid_state`
    );
  });

  it("sends cancelled and provider errors back to the page; the request stays open", async () => {
    const req = await startRequest();
    const cancelled = await browserFlow("google", req.code, () => ({
      error: "access_denied",
    }));
    expect(cancelled.back.searchParams.get("error")).toBe("cancelled");

    fake.state.handler = () => json({ error: "invalid_grant" }, 400);
    const rejected = await browserFlow("google", req.code, () => ({
      code: "bad",
    }));
    expect(rejected.back.searchParams.get("error")).toBe("invalid_oauth_code");

    fake.state.handler = () => new Response("down", { status: 503 });
    const down = await browserFlow("google", req.code, () => ({ code: "c" }));
    expect(down.back.searchParams.get("error")).toBe("provider_error");

    expect((await poll(req.code, req.pollSecret)).json.status).toBe("pending");
  });

  it("Discord: identify scope only, the user id becomes the identity", async () => {
    const req = await startRequest();
    fake.state.handler = byUrl({
      [DISCORD_TOKEN_URL]: () => json({ access_token: "discord-access" }),
      [DISCORD_USER_URL]: (call) => {
        expect(call.headers.authorization).toBe("Bearer discord-access");
        return json({ id: DISCORD_ID, username: "ignored", email: "x@y.z" });
      },
    });
    const { providerUrl } = await browserFlow("discord", req.code, () => ({
      code: "discord-code",
    }));
    expect(providerUrl.searchParams.get("scope")).toBe("identify");
    const done = await poll(req.code, req.pollSecret);
    expect(done.json.provider).toBe("discord");
    const row = await ctx.client.query(
      `select a.account_id from player_identities i join auth_accounts a on a.id = i.auth_account_id
       where i.provider = 'discord'`
    );
    expect(row.rows[0].account_id).toBe(DISCORD_ID);
  });

  it("Apple on the web: signed client secret, refresh token stored encrypted for revocation", async () => {
    const req = await startRequest();
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
    const { providerUrl } = await browserFlow("apple", req.code, () => ({
      code: "apple-code",
    }));
    expect(providerUrl.searchParams.get("response_mode")).toBe("query");
    expect(providerUrl.searchParams.has("scope")).toBe(false);
    expect((await poll(req.code, req.pollSecret)).json.status).toBe(
      "completed"
    );
    const row = await ctx.client.query(
      "select refresh_token, client_id from auth_accounts where provider_id = 'apple'"
    );
    expect(row.rows[0].client_id).toBe(APPLE_SERVICES_ID);
    expect(row.rows[0].refresh_token).not.toContain("plain");
    expect(row.rows[0].refresh_token.length).toBeGreaterThan(20);
  });

  it("Steam OpenID: check_authentication at Steam, same identity as the ticket", async () => {
    const req = await startRequest();
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
        "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to",
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
    const ok = await browserFlow("steam", req.code, answer);
    expect(ok.providerUrl.origin + ok.providerUrl.pathname).toBe(
      STEAM_OPENID_URL
    );
    const done = await poll(req.code, req.pollSecret);
    expect(done.json.provider).toBe("steam");
    const ids = await ctx.req("GET", "/me/identities", {
      token: done.json.auth.token,
    });
    expect(ids.json.items[0].maskedId).toBe(`***${STEAM_ID.slice(-4)}`);

    const refused = await startRequest();
    fake.state.handler = () => new Response("is_valid:false\n");
    const bad = await browserFlow("steam", refused.code, answer);
    expect(bad.back.searchParams.get("error")).toBe("invalid_steam_openid");
    const forged = await browserFlow("steam", refused.code, (u) => ({
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
    const req = await startRequest({ token: guest.token, link: true });
    const info = await ctx.req("GET", `/auth/web-login/${req.code}`);
    expect(info.json.account).toEqual({ name: "Docht", level: 1 });
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-link-1"),
    });
    await browserFlow("google", req.code, () => ({ code: "c" }));
    const done = await poll(req.code, req.pollSecret);
    expect(done.json.status).toBe("completed");
    expect(done.json.result).toBe("linked");
    expect(done.json.removedPlayerId).toBeNull();
    expect(done.json.auth.player.id).toBe(guest.id);
    const ids = await ctx.req("GET", "/me/identities", { token: guest.token });
    expect(
      ids.json.items.map((i: { provider: string }) => i.provider).sort()
    ).toEqual(["device", "google"]);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("link: an empty account with the login is absorbed silently", async () => {
    // A Google account that signed in once and has no progress.
    const first = await startRequest();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-empty"),
    });
    await browserFlow("google", first.code, () => ({ code: "c" }));
    const empty = (await poll(first.code, first.pollSecret)).json.auth;

    const guest = await ctx.login();
    await ctx.reportRun(guest.token, { participants: [guest.id] });
    const req = await startRequest({ token: guest.token, link: true });
    await browserFlow("google", req.code, () => ({ code: "c" }));
    const done = await poll(req.code, req.pollSecret);
    expect(done.json.status).toBe("completed");
    expect(done.json.merged).toBe(false);
    expect(done.json.removedPlayerId).toBe(empty.player.id);
    expect(done.json.auth.player.id).toBe(guest.id);
    expect((await ctx.req("GET", "/me", { token: empty.token })).status).toBe(
      401
    );
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("link: two accounts with progress wait for the browser's confirmation", async () => {
    const first = await startRequest();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-progress"),
    });
    await browserFlow("google", first.code, () => ({ code: "c" }));
    const older = (await poll(first.code, first.pollSecret)).json.auth;
    await ctx.reportRun(older.token, { participants: [older.player.id] });

    const guest = await ctx.login("Jungspund");
    await ctx.reportRun(guest.token, { participants: [guest.id] });
    const req = await startRequest({ token: guest.token, link: true });
    const flow = await browserFlow("google", req.code, () => ({ code: "c" }));
    const confirm = flow.back.searchParams.get("confirm") ?? "";
    expect(confirm.length).toBeGreaterThan(20);
    expect((await poll(req.code, req.pollSecret)).json.status).toBe(
      "confirm_merge"
    );

    const withoutSecret = await ctx.req("GET", `/auth/web-login/${req.code}`);
    expect(withoutSecret.json.status).toBe("confirm_merge");
    expect(withoutSecret.json.merge).toBeNull();
    const withSecret = await ctx.req(
      "GET",
      `/auth/web-login/${req.code}?confirm=${confirm}`
    );
    expect(withSecret.json.merge.remaining.id).toBe(older.player.id);
    expect(withSecret.json.merge.removed.id).toBe(guest.id);

    const wrong = await ctx.req("POST", "/auth/web-login/confirm-merge", {
      body: { code: req.code, confirmSecret: "w".repeat(40) },
    });
    expect(wrong.status).toBe(404);
    const confirmed = await ctx.req("POST", "/auth/web-login/confirm-merge", {
      body: { code: req.code, confirmSecret: confirm },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.status).toBe("completed");
    expect(confirmed.json.merged).toBe(true);

    const done = await poll(req.code, req.pollSecret);
    expect(done.json.merged).toBe(true);
    expect(done.json.removedPlayerId).toBe(guest.id);
    expect(done.json.auth.player.id).toBe(older.player.id);
    expect((await ctx.req("GET", "/me", { token: guest.token })).status).toBe(
      401
    );
    const ids = await ctx.req("GET", "/me/identities", {
      token: done.json.auth.token,
    });
    expect(
      ids.json.items.map((i: { provider: string }) => i.provider).sort()
    ).toEqual(["device", "google"]);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("sign-in of a banned player fails with reason; finished requests refuse new flows", async () => {
    const first = await startRequest();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("google-sub-banned"),
    });
    await browserFlow("google", first.code, () => ({ code: "c" }));
    const player = (await poll(first.code, first.pollSecret)).json.auth.player;
    const admin = await ctx.createAdmin();
    await ctx.req("POST", `/admin/players/${player.id}/bans`, {
      token: admin.token,
      body: { reason: "Testsperre", durationDays: 7 },
    });

    const req = await startRequest();
    await browserFlow("google", req.code, () => ({ code: "c" }));
    const failed = await poll(req.code, req.pollSecret);
    expect(failed.json.status).toBe("failed");
    expect(failed.json.error).toBe("banned");
    expect(failed.json.reason).toBe("Testsperre");
    expect(failed.json.expiresAt).toBeString();

    const again = await ctx.app.request(
      `/auth/oauth/google/start?code=${req.code}`
    );
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
    const req = await ctx.req("POST", "/auth/web-login", { body: {} });
    const start = await ctx.app.request(
      `/auth/oauth/google/start?code=${req.json.code}`
    );
    expect(start.headers.get("location")).toBe(
      `${WEB}/login/${req.json.code}?error=provider_not_configured`
    );
    const info = await ctx.req("GET", `/auth/web-login/${req.json.code}`);
    expect(info.json.methods).toEqual([]);
    const magic = await ctx.req("POST", "/auth/magic-link", {
      body: { email: "someone@example.org", code: req.json.code },
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
      const req = await timed.req("POST", "/auth/web-login", { body: {} });
      clock = new Date(clock.getTime() + 601_000);
      const polled = await timed.req("POST", "/auth/web-login/poll", {
        body: { code: req.json.code, pollSecret: req.json.pollSecret },
      });
      expect(polled.json).toEqual({ status: "expired" });
    } finally {
      await timed.close();
    }
  });
});
