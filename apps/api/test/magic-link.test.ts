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
import {
  completeFlow,
  confirmWebLogin,
  pollWebLogin,
  type StartedWebLogin,
  startWebLogin,
} from "./web-login-flow.ts";

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

  const startRequest = (token?: string) =>
    startWebLogin(ctx, token ? { token, link: true } : {});

  async function sendLink(
    email: string,
    req: StartedWebLogin,
    locale?: string
  ) {
    const res = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email,
        code: req.code,
        browserToken: req.browserToken,
        ...(locale ? { locale } : {}),
      },
    });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ sent: true });
    // The mail goes out after the answer: wait for it (or for nothing to come).
    const before = mails.length;
    for (let i = 0; i < 50 && mails.length === before; i += 1) {
      await Bun.sleep(10);
    }
    const mail = mails.length > before ? mails.at(-1) : undefined;
    return (mail?.text ?? "").match(TOKEN_IN_LINK)?.[1] ?? null;
  }

  /** Link sent, clicked, confirmed with the game's code; returns the game's poll answer. */
  async function magicFlow(email: string, req: StartedWebLogin) {
    const token = await sendLink(email, req);
    const verified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    expect(verified.json.status).toBe("awaiting_confirm");
    const confirmed = await confirmWebLogin(
      ctx,
      req.code,
      verified.json.confirmSecret,
      req.userCode
    );
    expect(confirmed.status).toBe(200);
    return { verified, confirmed, polled: await pollWebLogin(ctx, req) };
  }

  it("sends a link that names another device, previews without using it, confirms with the game's code", async () => {
    const req = await startRequest();
    const token = await sendLink(" Lumen.Test@Example.org ", req, "de");
    expect(token).not.toBeNull();
    const mail = mails[0];
    expect(mail?.to).toBe("lumen.test@example.org");
    expect(mail?.from).toBe("Soulwick <login@example.test>");
    expect(mail?.subject).toBe("Ein Spiel bei Soulwick anmelden");
    expect(mail?.text).toContain("ANDEREN Gerät");
    // Neither the code of the request nor the game's code is in the mail.
    expect(mail?.text).not.toContain(req.code);
    expect(mail?.text).not.toContain(req.userCode);

    const preview = await ctx.req(
      "GET",
      `/auth/magic-link/preview?token=${token}`
    );
    expect(preview.status).toBe(200);
    expect(preview.json.intent).toBe("sign_in");
    expect((await pollWebLogin(ctx, req)).json.status).toBe("pending");

    const verified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    expect(verified.status).toBe(200);
    expect(verified.json.status).toBe("awaiting_confirm");
    expect(verified.json.newAccount).toBe(true);
    expect((await pollWebLogin(ctx, req)).json.status).toBe("awaiting_confirm");
    const reused = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    expect(reused.status).toBe(400);
    expect(reused.json.error).toBe("invalid_magic_link");

    await confirmWebLogin(
      ctx,
      req.code,
      verified.json.confirmSecret,
      req.userCode
    );
    const done = await pollWebLogin(ctx, req);
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
    const second = await magicFlow("lumen.test@example.org", again);
    expect(second.polled.json.auth.player.id).toBe(done.json.auth.player.id);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("never links through a matching e-mail: Google with the same address stays its own account", async () => {
    const byMail = (await magicFlow("same@example.org", await startRequest()))
      .polled.json.auth.player.id;

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
    const g = await startRequest();
    const byGoogle = (
      await completeFlow(ctx, "google", g, () => ({ code: "c" }))
    ).polled.json.auth.player.id;
    expect(byGoogle).not.toBe(byMail);
  });

  it("adds an e-mail to the game's account; a newer address replaces the old one", async () => {
    const guest = await ctx.login("Postfach");
    const req = await startRequest(guest.token);
    const token = await sendLink("first@example.org", req);
    expect(mails[0]?.subject).toBe("Add your e-mail to a Soulwick account");
    const preview = await ctx.req(
      "GET",
      `/auth/magic-link/preview?token=${token}`
    );
    expect(preview.json.account).toEqual({ name: "Postfach", level: 1 });
    const verified = await ctx.req("POST", "/auth/magic-link/verify", {
      body: { token },
    });
    await confirmWebLogin(
      ctx,
      req.code,
      verified.json.confirmSecret,
      req.userCode
    );
    const done = await pollWebLogin(ctx, req);
    expect(done.json.result).toBe("linked");
    expect(done.json.auth.player.id).toBe(guest.id);

    await magicFlow("second@example.org", await startRequest(guest.token));
    const ids = await ctx.req("GET", "/me/identities", { token: guest.token });
    const emails = ids.json.items.filter(
      (i: { provider: string }) => i.provider === "email"
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].label).toBe("se***@example.org");

    // The old address is free: it signs in to a new account now.
    const fresh = await magicFlow("first@example.org", await startRequest());
    expect(fresh.polled.json.auth.player.id).not.toBe(guest.id);

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

  it("a merge found by the magic link is shown and done in the same confirmation", async () => {
    const older = (await magicFlow("merge@example.org", await startRequest()))
      .polled.json.auth;
    await ctx.reportRun(older.token, { participants: [older.player.id] });

    const guest = await ctx.login();
    await ctx.reportRun(guest.token, { participants: [guest.id] });
    const { verified, confirmed, polled } = await magicFlow(
      "merge@example.org",
      await startRequest(guest.token)
    );
    expect(verified.json.merge.bothHaveProgress).toBe(true);
    expect(verified.json.merge.remaining.id).toBe(older.player.id);
    expect(confirmed.json.merged).toBe(true);
    expect(polled.json.auth.player.id).toBe(older.player.id);
    const ids = await ctx.req("GET", "/me/identities", {
      token: polled.json.auth.token,
    });
    expect(
      ids.json.items.filter((i: { provider: string }) => i.provider === "email")
    ).toHaveLength(1);
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("answers the same for admin addresses and above the per-address limit, but sends nothing", async () => {
    const admin = await ctx.createAdmin();
    const req = await startRequest();
    expect(await sendLink(admin.email, req)).toBeNull();
    expect(mails).toHaveLength(0);

    expect(await sendLink("limit@example.org", req)).not.toBeNull();
    expect(await sendLink("limit@example.org", req)).not.toBeNull();
    mails.length = 0;
    expect(await sendLink("limit@example.org", req)).toBeNull();
    expect(mails).toHaveLength(0);
  });

  it("rejects unknown requests, bad tokens and a failing mail worker", async () => {
    const unknown = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "a@example.org",
        code: "ABCDEFGH",
        browserToken: "k".repeat(43),
      },
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
      body: {
        email: "not-an-address",
        code: "ABCDEFGH",
        browserToken: "k".repeat(43),
      },
    });
    expect(invalid.status).toBe(400);

    const req = await startRequest();
    fake.state.handler = () => new Response("down", { status: 500 });
    const down = await ctx.req("POST", "/auth/magic-link", {
      body: {
        email: "down@example.org",
        code: req.code,
        browserToken: req.browserToken,
      },
    });
    // The answer does not wait for the mail (timing oracle); the failure only goes to the log.
    expect(down.status).toBe(202);
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
    const req = await startWebLogin(ctx);
    const body = {
      email: "ip@example.org",
      code: req.code,
      browserToken: req.browserToken,
    };
    expect((await ctx.req("POST", "/auth/magic-link", { body })).status).toBe(
      202
    );
    const second = await ctx.req("POST", "/auth/magic-link", { body });
    expect(second.status).toBe(429);
  });
});
