import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { GOOGLE_OAUTH_TOKEN_URL } from "../src/services/oauth.ts";
import { authIntegrityIssues } from "./auth-integrity.ts";
import {
  byUrl,
  type FakeCall,
  fakeFetch,
  json,
  unsignedJwt,
} from "./fake-fetch.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const WEB = "http://web.test";
const WORKER = "https://mail-worker.example.test/send";
const WORKER_KEY = "test-mail-worker-key-0123456789abcdef";
const GOOGLE_CLIENT = "test-web-client.apps.googleusercontent.com";
const TOKEN_IN_LINK = /\/login\/magic\?token=([\w-]+)/;

describe("magic link (KF5)", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  const mails: { to: string; subject: string; text: string; from: string }[] =
    [];

  beforeAll(async () => {
    ctx = await createTestContext(
      {
        WEB_URL: WEB,
        MAIL_ADAPTER: "cloudflare",
        MAIL_FROM: "Soulwick <login@example.test>",
        MAIL_CLOUDFLARE_URL: WORKER,
        MAIL_CLOUDFLARE_KEY: WORKER_KEY,
        MAGIC_LINKS_PER_ADDRESS_PER_HOUR: "2",
        GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
        GOOGLE_CLIENT_SECRET: "test-google-secret",
      },
      { fetch: fake.fetch }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    mails.length = 0;
    fake.state.handler = byUrl({
      [WORKER]: (call: FakeCall) => {
        expect(call.headers.authorization).toBe(`Bearer ${WORKER_KEY}`);
        mails.push(JSON.parse(call.body ?? "{}"));
        return json({ ok: true });
      },
    });
  });

  async function startRequest(token?: string) {
    const res = await ctx.req("POST", "/auth/web-login", {
      token,
      body: token ? { intent: "link" } : {},
    });
    return res.json as { code: string; pollSecret: string };
  }

  async function sendLink(email: string, code: string, locale?: string) {
    const res = await ctx.req("POST", "/auth/magic-link", {
      body: { email, code, ...(locale ? { locale } : {}) },
    });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ sent: true });
    const mail = mails.at(-1);
    return (mail?.text ?? "").match(TOKEN_IN_LINK)?.[1] ?? null;
  }

  const poll = (code: string, pollSecret: string) =>
    ctx.req("POST", "/auth/web-login/poll", { body: { code, pollSecret } });

  it("sends a link with the code, previews without using it, signs in and creates the account", async () => {
    const req = await startRequest();
    const token = await sendLink(" Lumen.Test@Example.org ", req.code, "de");
    expect(token).not.toBeNull();
    const mail = mails[0];
    expect(mail?.to).toBe("lumen.test@example.org");
    expect(mail?.from).toBe("Soulwick <login@example.test>");
    expect(mail?.subject).toBe("Dein Anmeldelink für Soulwick");
    expect(mail?.text).toContain(
      `${req.code.slice(0, 4)}-${req.code.slice(4)}`
    );

    const preview = await ctx.req(
      "GET",
      `/auth/magic-link/preview?token=${token}`
    );
    expect(preview.status).toBe(200);
    expect(preview.json.code).toBe(req.code);
    expect(preview.json.intent).toBe("sign_in");
    expect((await poll(req.code, req.pollSecret)).json.status).toBe("pending");

    const verified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    expect(verified.status).toBe(200);
    expect(verified.json.status).toBe("completed");
    const reused = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    expect(reused.status).toBe(400);
    expect(reused.json.error).toBe("invalid_magic_link");

    const done = await poll(req.code, req.pollSecret);
    expect(done.json.provider).toBe("email");
    const ids = await ctx.req("GET", "/me/identities", {
      token: done.json.auth.token,
    });
    expect(ids.json.items[0].provider).toBe("email");
    expect(ids.json.items[0].label).toBe("lu***@example.org");
    const user = await ctx.client.query(
      "select email, email_verified from auth_users where player_id = $1",
      [done.json.auth.player.id]
    );
    expect(user.rows[0]).toEqual({
      email: "lumen.test@example.org",
      email_verified: true,
    });

    // The same address again: the same account.
    const again = await startRequest();
    const token2 = await sendLink("lumen.test@example.org", again.code);
    await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: token2 },
    });
    const second = await poll(again.code, again.pollSecret);
    expect(second.json.auth.player.id).toBe(done.json.auth.player.id);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("never links through a matching e-mail: Google with the same address stays its own account", async () => {
    const req = await startRequest();
    await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: await sendLink("same@example.org", req.code) },
    });
    const byMail = (await poll(req.code, req.pollSecret)).json.auth.player.id;

    const g = await startRequest();
    fake.state.handler = byUrl({
      [GOOGLE_OAUTH_TOKEN_URL]: () =>
        json({
          id_token: unsignedJwt({
            iss: "https://accounts.google.com",
            aud: GOOGLE_CLIENT,
            sub: "google-sub-same-mail",
            email: "same@example.org",
            email_verified: true,
            exp: Math.floor(Date.now() / 1000) + 600,
          }),
        }),
    });
    const start = await ctx.app.request(
      `/auth/oauth/google/start?code=${g.code}`
    );
    const state = new URL(start.headers.get("location") ?? "").searchParams.get(
      "state"
    );
    await ctx.app.request(`/auth/oauth/google/callback?state=${state}&code=c`, {
      headers: {
        cookie: (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
      },
    });
    const byGoogle = (await poll(g.code, g.pollSecret)).json.auth.player.id;
    expect(byGoogle).not.toBe(byMail);
  });

  it("adds an e-mail to the game's account; a newer address replaces the old one", async () => {
    const guest = await ctx.login("Postfach");
    const req = await startRequest(guest.token);
    const token = await sendLink("first@example.org", req.code);
    expect(mails[0]?.subject).toBe("Confirm your e-mail for Soulwick");
    const preview = await ctx.req(
      "GET",
      `/auth/magic-link/preview?token=${token}`
    );
    expect(preview.json.account).toEqual({ name: "Postfach", level: 1 });
    await ctx.req("POST", "/auth/magic-link/verify", { body: { token } });
    const done = await poll(req.code, req.pollSecret);
    expect(done.json.result).toBe("linked");
    expect(done.json.auth.player.id).toBe(guest.id);

    const req2 = await startRequest(guest.token);
    await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: await sendLink("second@example.org", req2.code) },
    });
    await poll(req2.code, req2.pollSecret);
    const ids = await ctx.req("GET", "/me/identities", { token: guest.token });
    const emails = ids.json.items.filter(
      (i: { provider: string }) => i.provider === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].label).toBe("se***@example.org");

    // The old address is free: it signs in to a new account now.
    const other = await startRequest();
    await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: await sendLink("first@example.org", other.code) },
    });
    const fresh = await poll(other.code, other.pollSecret);
    expect(fresh.json.auth.player.id).not.toBe(guest.id);

    const unlinked = await ctx.req("DELETE", "/me/identities/email", {
      token: guest.token,
    });
    expect(unlinked.status).toBe(200);
    const user = await ctx.client.query(
      "select email from auth_users where player_id = $1",
      [guest.id]
    );
    expect(user.rows[0].email).toEndWith("@players.soulwick.invalid");
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("a merge found by the magic link returns the confirm secret to the page", async () => {
    const req = await startRequest();
    await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: await sendLink("merge@example.org", req.code) },
    });
    const older = (await poll(req.code, req.pollSecret)).json.auth;
    await ctx.reportRun(older.token, { participants: [older.player.id] });

    const guest = await ctx.login();
    await ctx.reportRun(guest.token, { participants: [guest.id] });
    const link = await startRequest(guest.token);
    const verified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: await sendLink("merge@example.org", link.code) },
    });
    expect(verified.json.status).toBe("confirm_merge");
    expect(verified.json.merge.remaining.id).toBe(older.player.id);
    const confirmed = await ctx.req("POST", "/auth/web-login/confirm-merge", {
      body: { code: link.code, confirmSecret: verified.json.confirmSecret },
    });
    expect(confirmed.json.status).toBe("completed");
    const done = await poll(link.code, link.pollSecret);
    expect(done.json.auth.player.id).toBe(older.player.id);
    // One e-mail per account: the address stays with the remaining account.
    const ids = await ctx.req("GET", "/me/identities", {
      token: done.json.auth.token,
    });
    expect(
      ids.json.items.filter((i: { provider: string }) => i.provider === "email")
    ).toHaveLength(1);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("answers the same for admin addresses and above the per-address limit, but sends nothing", async () => {
    const admin = await ctx.createAdmin();
    const req = await startRequest();
    expect(await sendLink(admin.email, req.code)).toBeNull();
    expect(mails).toHaveLength(0);

    expect(await sendLink("limit@example.org", req.code)).not.toBeNull();
    expect(await sendLink("limit@example.org", req.code)).not.toBeNull();
    mails.length = 0;
    expect(await sendLink("limit@example.org", req.code)).toBeNull();
    expect(mails).toHaveLength(0);
  });

  it("rejects unknown requests, bad tokens and a failing mail worker", async () => {
    const unknown = await ctx.req("POST", "/auth/magic-link", {
      body: { email: "a@example.org", code: "ABCDEFGH" },
    });
    expect(unknown.status).toBe(404);
    const bad = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token: "x".repeat(43) },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_magic_link");
    const preview = await ctx.req(
      "GET",
      `/auth/magic-link/preview?token=${"y".repeat(43)}`
    );
    expect(preview.status).toBe(400);
    const invalid = await ctx.req("POST", "/auth/magic-link", {
      body: { email: "not-an-address", code: "ABCDEFGH" },
    });
    expect(invalid.status).toBe(400);

    const req = await startRequest();
    fake.state.handler = () => new Response("down", { status: 500 });
    const down = await ctx.req("POST", "/auth/magic-link", {
      body: { email: "down@example.org", code: req.code },
    });
    expect(down.status).toBe(502);
    expect(down.json.error).toBe("mail_unavailable");
  });
});

describe("magic link rate limit per IP", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({
      MAIL_ADAPTER: "log",
      MAGIC_LINKS_PER_HOUR: "1",
    });
  });
  afterAll(() => ctx.close());

  it("answers 429 above MAGIC_LINKS_PER_HOUR", async () => {
    const req = await ctx.req("POST", "/auth/web-login", { body: {} });
    const body = { email: "ip@example.org", code: req.json.code };
    expect((await ctx.req("POST", "/auth/magic-link", { body })).status).toBe(
      202
    );
    const second = await ctx.req("POST", "/auth/magic-link", { body });
    expect(second.status).toBe(429);
  });
});
