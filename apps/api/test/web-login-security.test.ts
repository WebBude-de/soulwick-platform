import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { Hono } from "hono";
import { cidrMatcher } from "../src/lib/client-ip.ts";
import { createErrorHandler } from "../src/lib/errors.ts";
import { requestLogger } from "../src/lib/logger.ts";
import { hmacSecret } from "../src/lib/secrets.ts";
import {
  LOCAL_PLAYER_PASSWORD,
  seedPlayerPassword,
} from "../src/scripts/seed-player-password.ts";
import { GOOGLE_OAUTH_TOKEN_URL } from "../src/services/oauth.ts";
import { STEAM_OPENID_URL } from "../src/services/steam-openid.ts";
import { confirmWebLogin as confirmWebLoginService } from "../src/services/web-login.ts";
import {
  byUrl,
  type FakeCall,
  fakeFetch,
  json,
  unsignedJwt,
} from "./fake-fetch.ts";
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

/**
 * KF5 security fixes (review of 03.11.2026, P-039): each test is an attack that worked before.
 */

const WEB = "http://web.test";
const GOOGLE_CLIENT = "test-web-client.apps.googleusercontent.com";
const WORKER = "https://mail-worker.example.test/send";
const TOKEN_IN_LINK = /\/login\/magic\?token=([\w-]+)/;
const now = () => Math.floor(Date.now() / 1000);
const googleToken = (sub: string) =>
  json({
    access_token: "x",
    id_token: unsignedJwt({
      iss: "https://accounts.google.com",
      aud: GOOGLE_CLIENT,
      sub,
      iat: now(),
      exp: now() + 3600,
    }),
  });
const googleCode = () => ({ code: "c" });

describe("web login: code phishing and visible codes", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  let lastMail = "";
  let mailText = "";

  beforeAll(async () => {
    ctx = await createTestContext(
      {
        WEB_URL: WEB,
        GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
        GOOGLE_CLIENT_SECRET: "s",
        STEAM_OPENID_ENABLED: "true",
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
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("victim-google"),
      [WORKER]: (call: FakeCall) => {
        lastMail = JSON.parse(call.body ?? "{}").text;
        return json({ ok: true });
      },
    });
  });

  /** The link of the next magic link mail (mails go out after the answer). */
  async function nextMailToken() {
    for (let i = 0; i < 100 && !TOKEN_IN_LINK.test(lastMail); i += 1) {
      await Bun.sleep(10);
    }
    mailText = lastMail;
    lastMail = "";
    return mailText.match(TOKEN_IN_LINK)?.[1];
  }

  /** The victim: a Google account with progress. */
  async function victimAccount() {
    const v = await startWebLogin(ctx);
    const auth = (await completeFlow(ctx, "google", v, googleCode)).polled.json
      .auth;
    await ctx.reportRun(auth.token, { participants: [auth.player.id] });
    return auth;
  }

  it("PoC link: an empty attacker account does not get the victim's session from its link", async () => {
    const victim = await victimAccount();
    const attacker = await ctx.login("Evil");
    const a = await startWebLogin(ctx, { token: attacker.token, link: true });
    // The victim opens the attacker's link (with k) and signs in with Google.
    const flow = await browserFlow(ctx, "google", a, googleCode);
    expect((await pollWebLogin(ctx, a)).json.status).toBe("awaiting_confirm");
    // The victim's page says which account the game would get, and asks for the game's code.
    const page = await ctx.req(
      "GET",
      `/auth/web-login/${a.code}?confirm=${flow.confirmSecret}`
    );
    expect(page.json.account.name).toBe(victim.player.name);
    expect(page.json.merge.removed.id).toBe(attacker.id);
    // The victim does not know the code on the attacker's screen: guesses fail and burn it.
    for (let i = 0; i < 5; i += 1) {
      const wrong = await confirmWebLogin(
        ctx,
        a.code,
        flow.confirmSecret ?? "",
        `ABC-DE${"FGHJK"[i]}`
      );
      expect(wrong.status).toBe(400);
      expect(wrong.json.error).toBe("wrong_code");
      expect(wrong.json.attemptsLeft).toBe(4 - i);
    }
    const right = await confirmWebLogin(
      ctx,
      a.code,
      flow.confirmSecret ?? "",
      a.userCode
    );
    expect(right.status).toBe(409);
    const polled = await pollWebLogin(ctx, a);
    expect(polled.json).toEqual({
      status: "failed",
      error: "too_many_attempts",
    });
    // Nothing was merged: the attacker's guest still exists, the victim keeps its login.
    expect(
      (await ctx.req("GET", "/me", { token: attacker.token })).status
    ).toBe(200);
    expect((await ctx.req("GET", "/me", { token: victim.token })).status).toBe(
      200
    );
  });

  it("PoC sign-in: a victim signing in on the attacker's link does not hand out a session", async () => {
    await victimAccount();
    const a = await startWebLogin(ctx);
    const flow = await browserFlow(ctx, "google", a, googleCode);
    expect(flow.confirmSecret).not.toBeNull();
    const polled = await pollWebLogin(ctx, a);
    expect(polled.json.status).toBe("awaiting_confirm");
    expect(polled.json.auth).toBeUndefined();
    // The confirm secret alone (without the code from the game) finishes nothing.
    const noCode = await confirmWebLogin(
      ctx,
      a.code,
      flow.confirmSecret ?? "",
      ""
    );
    expect(noCode.status).toBe(400);
    // The poll secret is no confirm secret either.
    const pollAsConfirm = await confirmWebLogin(
      ctx,
      a.code,
      a.pollSecret,
      a.userCode
    );
    expect(pollAsConfirm.status).toBe(404);
    expect((await pollWebLogin(ctx, a)).json.status).toBe("awaiting_confirm");
  });

  it("PoC magic link: the victim's click on a real mail does not sign the attacker's game in", async () => {
    // Victim account with an e-mail.
    const v = await startWebLogin(ctx);
    await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "victim@example.org",
        code: v.code,
        browserToken: v.browserToken,
      },
    });
    const vToken = await nextMailToken();
    const vVerified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: vToken },
    });
    await confirmWebLogin(
      ctx,
      v.code,
      vVerified.json.confirmSecret,
      v.userCode
    );
    await pollWebLogin(ctx, v);

    // Attacker types the victim's address on the attacker's own page.
    const a = await startWebLogin(ctx);
    await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "victim@example.org",
        code: a.code,
        browserToken: a.browserToken,
      },
    });
    const token = await nextMailToken();
    expect(mailText).toContain("ANOTHER device");
    expect(mailText).not.toContain(a.userCode);
    // The victim clicks "Continue" in the genuine Soulwick mail.
    const verified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    expect(verified.json.status).toBe("awaiting_confirm");
    expect((await pollWebLogin(ctx, a)).json.status).toBe("awaiting_confirm");
  });

  it("visible code: without the browser token the code shows nothing and starts nothing", async () => {
    const streamer = await ctx.login("Streamerin");
    const s = await startWebLogin(ctx, { token: streamer.token, link: true });
    // A viewer saw `code` and `userCode` on the stream, but has no browser token.
    const info = await webLoginInfo(ctx, s.code);
    expect(info.status).toBe(200);
    expect(info.json.authorized).toBe(false);
    expect(info.json.account).toBeNull();
    expect(info.json.intent).toBeNull();
    expect(info.json.methods).toEqual([]);
    const wrongToken = await webLoginInfo(ctx, s.code, {
      browserToken: "w".repeat(43),
    });
    expect(wrongToken.json.authorized).toBe(false);
    const redirect = await oauthStart(ctx, "google", s.code, "w".repeat(43));
    expect(redirect.headers.get("location")).toBe(
      `${WEB}/login?error=web_login_not_found`
    );
    const mail = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "viewer@example.org",
        code: s.code,
        browserToken: "w".repeat(43),
      },
    });
    expect(mail.status).toBe(404);
    expect((await pollWebLogin(ctx, s)).json.status).toBe("pending");
  });

  it("k works once: after the claim the URL secret starts nothing (no GET links any more)", async () => {
    const s = await startWebLogin(ctx, { claim: false });
    const first = await ctx.req("POST", "/auth/web-login/claim", {
      body: { code: s.code, k: s.browserSecret },
    });
    expect(first.status).toBe(200);
    expect(first.json.browserToken).not.toBe(s.browserSecret);
    const second = await ctx.req("POST", "/auth/web-login/claim", {
      body: { code: s.code, k: s.browserSecret },
    });
    expect(second.status).toBe(409);
    expect(second.json.error).toBe("web_login_claimed");
    const wrong = await ctx.req("POST", "/auth/web-login/claim", {
      body: { code: s.code, k: "w".repeat(43) },
    });
    expect(wrong.status).toBe(404);
    // `k` is no token, and the old GET link and `?k=` are gone.
    const withK = await oauthStart(ctx, "google", s.code, s.browserSecret);
    expect(withK.headers.get("location")).toBe(
      `${WEB}/login?error=web_login_not_found`
    );
    const getStart = await ctx.app.request(
      `/auth/oauth/google/start?code=${s.code}&k=${s.browserSecret}`
    );
    expect(getStart.status).toBe(404);
    const infoWithK = await ctx.req(
      "GET",
      `/auth/web-login/${s.code}?k=${s.browserSecret}`
    );
    expect(infoWithK.json.authorized).toBe(false);
    const mailWithK = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "someone@example.org",
        code: s.code,
        browserToken: s.browserSecret,
      },
    });
    expect(mailWithK.status).toBe(404);
    // The token works.
    const withToken = await oauthStart(
      ctx,
      "google",
      s.code,
      first.json.browserToken
    );
    expect(withToken.status).toBe(303);
    expect(withToken.headers.get("location")).toStartWith(
      "https://accounts.google.com/"
    );
  });

  it("the browser token shows no account data after a proof (only the proving browser sees it)", async () => {
    const victim = await victimAccount();
    const attacker = await ctx.login("Neugier");
    const a = await startWebLogin(ctx, { token: attacker.token, link: true });
    const flow = await browserFlow(ctx, "google", a, googleCode);
    const page = await webLoginInfo(ctx, a.code, {
      browserToken: a.browserToken,
    });
    expect(page.json.authorized).toBe(true);
    expect(page.json.status).toBe("awaiting_confirm");
    expect(page.json.account).toBeNull();
    expect(page.json.merge).toBeNull();
    expect(page.json.newAccount).toBe(false);
    const prover = await webLoginInfo(ctx, a.code, {
      confirm: flow.confirmSecret,
    });
    expect(prover.json.merge.remaining.id).toBe(victim.player.id);

    // Sign-in: whether a Google account is new must not show either.
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("unknown-google-xyz"),
    });
    const s = await startWebLogin(ctx);
    await browserFlow(ctx, "google", s, googleCode);
    const signIn = await webLoginInfo(ctx, s.code, {
      browserToken: s.browserToken,
    });
    expect(signIn.json.newAccount).toBe(false);
    expect(signIn.json.account).toBeNull();
  });

  it("race: a proof landing between the read and the transaction of a confirmation is not applied", async () => {
    const victim = await victimAccount();
    const a = await startWebLogin(ctx);
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("attacker-throwaway"),
    });
    const own = await browserFlow(ctx, "google", a, googleCode);
    // Between the confirmation's read and its transaction the victim (on the attacker's link)
    // finishes Google: that replaces the parked login and its confirm secret.
    const slowDb = new Proxy(ctx.db, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return async (...args: unknown[]) => {
            fake.state.handler = byUrl({
              [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("victim-google"),
            });
            await browserFlow(ctx, "google", a, googleCode);
            return await (
              target.$transaction as (...a: unknown[]) => Promise<unknown>
            )(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      confirmWebLoginService(slowDb, {
        code: a.code,
        confirmSecret: own.confirmSecret ?? "",
        typedCode: a.userCode,
        secret: hmacSecret(ctx.config),
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: "web_login_not_confirmable" });
    const polled = await pollWebLogin(ctx, a);
    expect(polled.json.status).toBe("awaiting_confirm");
    expect(polled.json.auth?.player.id).not.toBe(victim.player.id);
  });

  it("parallel guesses: attempts are counted before the comparison, never more than 5", async () => {
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () => googleToken("parallel-guesser"),
    });
    const a = await startWebLogin(ctx);
    const flow = await browserFlow(ctx, "google", a, googleCode);
    const guesses = await Promise.all(
      [
        "AAA",
        "BBB",
        "CCC",
        "DDD",
        "EEE",
        "FFF",
        "GGG",
        "HHH",
        "JJJ",
        "KKK",
      ].map((g) =>
        confirmWebLogin(ctx, a.code, flow.confirmSecret ?? "", `${g}-${g}`)
      )
    );
    const wrong = guesses.filter((r) => r.json.error === "wrong_code");
    expect(wrong).toHaveLength(5);
    expect(
      guesses.filter((r) => r.json.error === "web_login_not_confirmable")
    ).toHaveLength(5);
    const row = await ctx.client.query(
      "select confirm_attempts, status from web_login_requests where confirm_attempts > 0 order by created_at desc limit 1"
    );
    expect(row.rows[0]).toEqual({ confirm_attempts: 5, status: "failed" });
  });

  it("Steam OpenID: an assertion that does not sign its key fields is refused", async () => {
    const s = await startWebLogin(ctx);
    fake.state.handler = () => new Response("is_valid:true\n");
    const flow = await browserFlow(ctx, "steam", s, (providerUrl) => {
      const returnTo = providerUrl.searchParams.get("openid.return_to") ?? "";
      const id = "https://steamcommunity.com/openid/id/76561190000000078";
      return {
        state: new URL(returnTo).searchParams.get("state") ?? "",
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "id_res",
        "openid.op_endpoint": STEAM_OPENID_URL,
        "openid.claimed_id": id,
        "openid.identity": id,
        "openid.return_to": returnTo,
        "openid.response_nonce": "2026-11-03T12:00:00Zabc",
        "openid.assoc_handle": "1",
        // claimed_id and identity left out of the signature.
        "openid.signed": "signed,op_endpoint,return_to,response_nonce",
        "openid.sig": "c2ln",
      };
    });
    expect(flow.back.searchParams.get("error")).toBe("invalid_steam_openid");
    expect((await pollWebLogin(ctx, s)).json.status).toBe("pending");
  });
});

describe("magic links: lifetime cap and no timing oracle", () => {
  let clock = new Date();
  const fake = fakeFetch();
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext(
      {
        WEB_URL: WEB,
        MAIL_ADAPTER: "cloudflare",
        MAIL_FROM: "login@example.test",
        MAIL_CLOUDFLARE_URL: WORKER,
        MAIL_CLOUDFLARE_KEY: "test-mail-worker-key-0123456789abcdef",
        EXTERNAL_AUTH_TIMEOUT_MS: "5000",
      },
      { fetch: fake.fetch, now: () => clock }
    );
  });
  afterAll(() => ctx.close());

  it("a magic link never extends the request beyond createdAt + 20 minutes", async () => {
    fake.state.handler = () => json({ ok: true });
    clock = new Date();
    const s = await startWebLogin(ctx);
    clock = new Date(clock.getTime() + 9 * 60_000);
    await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "cap@example.org",
        code: s.code,
        browserToken: s.browserToken,
      },
    });
    await Bun.sleep(200);
    const row = await ctx.client.query(
      "select created_at, expires_at from web_login_requests order by created_at desc limit 1"
    );
    const lifetime =
      new Date(row.rows[0].expires_at).getTime() -
      new Date(row.rows[0].created_at).getTime();
    expect(lifetime).toBeLessThanOrEqual(20 * 60_000);
  });

  it("answers before the mail is sent: a hanging mail worker does not slow the answer", async () => {
    fake.state.handler = () => new Promise<Response>(() => undefined);
    clock = new Date();
    const s = await startWebLogin(ctx);
    const started = performance.now();
    const res = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "slow@example.org",
        code: s.code,
        browserToken: s.browserToken,
      },
    });
    expect(res.status).toBe(202);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("no secrets of /auth/* in the request log", () => {
  it("logs the path only, never the query string", async () => {
    const lines: unknown[] = [];
    const at = (msg: string, fields: Record<string, unknown> = {}) =>
      lines.push({ msg, fields });
    const logger = { debug: at, info: at, warn: at, error: at };
    const app = new Hono();
    app.onError(createErrorHandler(logger));
    app.use("*", requestLogger(logger, false));
    app.get("/auth/web-login/:code", (c) => c.json({ ok: true }));
    app.get("/auth/boom", () => {
      throw new Error("boom");
    });
    await app.request("/auth/web-login/ABCDEFGH?confirm=SECRET-CONFIRM");
    await app.request("/auth/boom?token=SECRET-TOKEN&state=SECRET-STATE");
    const text = JSON.stringify(lines);
    expect(text).toContain("/auth/web-login/ABCDEFGH");
    expect(text).not.toContain("SECRET");
  });
});

describe("rate limits on the web login page and the password setup", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ LOGIN_ATTEMPTS_PER_MINUTE: "2" });
  });
  afterAll(() => ctx.close());

  it("GET /auth/web-login/:code is limited per IP (code guessing)", async () => {
    const statuses: number[] = [];
    for (const code of ["ABCDEFGH", "ABCDEFGJ", "ABCDEFGK"]) {
      statuses.push((await ctx.req("GET", `/auth/web-login/${code}`)).status);
    }
    expect(statuses).toEqual([404, 404, 429]);
  });

  it("PUT /me/logins/password is limited per IP (username oracle)", async () => {
    const p = await ctx.login();
    const statuses: number[] = [];
    for (const username of ["probe-a", "probe-b", "probe-c"]) {
      statuses.push(
        (
          await ctx.req("PUT", "/me/logins/password", {
            token: p.token,
            body: { username },
          })
        ).status
      );
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("forwarded client IPs only from trusted proxies", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({
      LOGIN_ATTEMPTS_PER_MINUTE: "2",
      TRUST_PROXY: "true",
      TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 2400:cb00::/32",
    });
  });
  afterAll(() => ctx.close());

  it("a client outside TRUSTED_PROXY_CIDRS cannot dodge the limit with X-Forwarded-For", async () => {
    const statuses: number[] = [];
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      statuses.push(
        (
          await ctx.req("POST", "/auth/password", {
            headers: { "x-forwarded-for": ip, "cf-connecting-ip": ip },
            body: { username: "someone", password: "wrong-password-1" },
          })
        ).status
      );
    }
    expect(statuses).toEqual([401, 401, 429]);
  });

  it("matches IPv4, IPv6 and mapped addresses; rejects invalid entries", () => {
    const match = cidrMatcher(["10.0.0.0/8", "2400:cb00::/32", "172.17.0.5"]);
    expect(match?.("10.1.2.3")).toBe(true);
    expect(match?.("::ffff:10.1.2.3")).toBe(true);
    expect(match?.("11.0.0.1")).toBe(false);
    expect(match?.("2400:cb00:1::5")).toBe(true);
    expect(match?.("172.17.0.5")).toBe(true);
    expect(match?.("172.17.0.6")).toBe(false);
    expect(match?.("unknown")).toBe(false);
    expect(cidrMatcher(["10.0.0.0/33"])).toBeNull();
    expect(cidrMatcher(["not-an-ip"])).toBeNull();
  });
});

describe("dev seed password on servers", () => {
  it("uses the well-known local password only for a database on this machine", () => {
    expect(
      seedPlayerPassword({
        DATABASE_URL: "postgresql://u:p@localhost:5532/soulwick",
      })
    ).toEqual({ password: LOCAL_PLAYER_PASSWORD, local: true });
    expect(
      seedPlayerPassword({
        DATABASE_URL: "postgresql://u:p@soulwick-postgres-dev:5432/soulwick",
      })
    ).toBeNull();
    expect(
      seedPlayerPassword({
        DATABASE_URL: "postgresql://u:p@soulwick-postgres-dev:5432/soulwick",
        DEV_PLAYER_PASSWORD: LOCAL_PLAYER_PASSWORD,
      })
    ).toBeNull();
    expect(
      seedPlayerPassword({
        DATABASE_URL: "postgresql://u:p@db.internal:5432/soulwick",
        DEV_PLAYER_PASSWORD: "a-long-server-only-password",
      })
    ).toEqual({ password: "a-long-server-only-password", local: false });
  });
});
