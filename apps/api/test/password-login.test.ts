import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { authIntegrityIssues } from "./auth-integrity.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

const PASSWORD = "correct-horse-battery";

describe("username + password (KF5)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ PASSWORD_FAILURES_PER_USERNAME: "3" });
  });
  afterAll(() => ctx.close());

  it("adds a password login to a guest account and signs in with it", async () => {
    const guest = await ctx.login("Lichtfunke");
    const set = await ctx.req("PUT", "/me/logins/password", {
      token: guest.token,
      body: { username: "  Funke_01 ", password: PASSWORD },
    });
    expect(set.status).toBe(200);
    const pw = set.json.items.find(
      (i: { provider: string }) => i.provider === "password"
    );
    expect(pw.label).toBe("funke_01");

    const login = await ctx.req("POST", "/auth/password", {
      body: { username: "FUNKE_01", password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(login.json.player.id).toBe(guest.id);
    expect(login.json.player.name).toBe("Lichtfunke");
    const me = await ctx.req("GET", "/me", { token: login.json.token });
    expect(me.status).toBe(200);

    // The hash sits in auth_accounts (credential), linked to the identity (P-037).
    const rows = await ctx.client.query(
      `select a.provider_id, a.password from player_identities i
       join auth_accounts a on a.id = i.auth_account_id
       where i.player_id = $1 and i.provider = 'password'`,
      [guest.id]
    );
    expect(rows.rows[0].provider_id).toBe("credential");
    expect(rows.rows[0].password).toStartWith("$argon2id$");
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });

  it("answers unknown usernames and wrong passwords alike, then locks the username", async () => {
    const owner = await ctx.login();
    await ctx.req("PUT", "/me/logins/password", {
      token: owner.token,
      body: { username: "lockme", password: PASSWORD },
    });
    const unknown = await ctx.req("POST", "/auth/password", {
      body: { username: "nobody-here", password: PASSWORD },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("invalid_credentials");
    for (let i = 0; i < 3; i += 1) {
      const wrong = await ctx.req("POST", "/auth/password", {
        body: { username: "lockme", password: "wrong-password-123" },
      });
      expect(wrong.status).toBe(401);
      expect(wrong.json.error).toBe("invalid_credentials");
    }
    const locked = await ctx.req("POST", "/auth/password", {
      body: { username: "lockme", password: PASSWORD },
    });
    expect(locked.status).toBe(429);
    expect(locked.json.error).toBe("rate_limited");
  });

  it("refuses a taken username and incomplete first setup, changes username and password", async () => {
    const a = await ctx.login();
    const b = await ctx.login();
    await ctx.req("PUT", "/me/logins/password", {
      token: a.token,
      body: { username: "taken-name", password: PASSWORD },
    });
    const taken = await ctx.req("PUT", "/me/logins/password", {
      token: b.token,
      body: { username: "taken-name", password: PASSWORD },
    });
    expect(taken.status).toBe(409);
    expect(taken.json.error).toBe("username_taken");
    const onlyPassword = await ctx.req("PUT", "/me/logins/password", {
      token: b.token,
      body: { password: PASSWORD },
    });
    expect(onlyPassword.status).toBe(400);
    const short = await ctx.req("PUT", "/me/logins/password", {
      token: b.token,
      body: { username: "fine-name", password: "short" },
    });
    expect(short.status).toBe(400);
    const badName = await ctx.req("PUT", "/me/logins/password", {
      token: b.token,
      body: { username: "no@mail", password: PASSWORD },
    });
    expect(badName.status).toBe(400);

    const changed = await ctx.req("PUT", "/me/logins/password", {
      token: a.token,
      body: { username: "new-name", password: "another-long-secret" },
    });
    expect(changed.status).toBe(200);
    const old = await ctx.req("POST", "/auth/password", {
      body: { username: "taken-name", password: PASSWORD },
    });
    expect(old.status).toBe(401);
    const fresh = await ctx.req("POST", "/auth/password", {
      body: { username: "new-name", password: "another-long-secret" },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.json.player.id).toBe(a.id);
    // The old name is free again.
    const reuse = await ctx.req("PUT", "/me/logins/password", {
      token: b.token,
      body: { username: "taken-name", password: PASSWORD },
    });
    expect(reuse.status).toBe(200);
  });

  it("unlinking the password removes the hash; banned players get 403", async () => {
    const p = await ctx.login();
    await ctx.req("PUT", "/me/logins/password", {
      token: p.token,
      body: { username: "unlink-me", password: PASSWORD },
    });
    const unlinked = await ctx.req("DELETE", "/me/identities/password", {
      token: p.token,
    });
    expect(unlinked.status).toBe(200);
    const left = await ctx.client.query(
      `select count(*)::int as n from auth_accounts a join auth_users u on u.id = a.user_id
       where u.player_id = $1`,
      [p.id]
    );
    expect(left.rows[0].n).toBe(0);
    const gone = await ctx.req("POST", "/auth/password", {
      body: { username: "unlink-me", password: PASSWORD },
    });
    expect(gone.status).toBe(401);

    const q = await ctx.login();
    await ctx.req("PUT", "/me/logins/password", {
      token: q.token,
      body: { username: "banned-one", password: PASSWORD },
    });
    const admin = await ctx.createAdmin();
    await ctx.req("POST", `/admin/players/${q.id}/bans`, {
      token: admin.token,
      body: { reason: "Testsperre", durationDays: null },
    });
    const banned = await ctx.req("POST", "/auth/password", {
      body: { username: "banned-one", password: PASSWORD },
    });
    expect(banned.status).toBe(403);
    expect(banned.json.error).toBe("banned");
    expect(banned.json.reason).toBe("Testsperre");
    expect(await authIntegrityIssues(ctx.client)).toEqual([]);
  });
});

describe("password login rate limit per IP", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ LOGIN_ATTEMPTS_PER_MINUTE: "2" });
  });
  afterAll(() => ctx.close());

  it("answers 429 above LOGIN_ATTEMPTS_PER_MINUTE", async () => {
    const body = { username: "someone", password: PASSWORD };
    expect((await ctx.req("POST", "/auth/password", { body })).status).toBe(
      401
    );
    expect((await ctx.req("POST", "/auth/password", { body })).status).toBe(
      401
    );
    const third = await ctx.req("POST", "/auth/password", { body });
    expect(third.status).toBe(429);
    expect(third.json.error).toBe("rate_limited");
  });
});
