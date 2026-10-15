import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  PLAYER_JWKS_PATH,
  PLAYER_JWT_AUDIENCE,
  PLAYER_JWT_TTL_SECONDS,
} from "@soulwick/contracts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

/** Better Auth for admins and players (P-027). */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** Verifies an EdDSA JWT against a JWKS with WebCrypto (no extra dependency in the API). */
async function verifyEd25519(
  jwt: string,
  jwks: { keys: Record<string, string>[] }
): Promise<boolean> {
  const [header, payload, signature] = jwt.split(".");
  if (!(header && payload && signature)) {
    return false;
  }
  const kid = decodePart(header).kid;
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  return await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`)
  );
}

/** Same session token with one character of the signature changed. */
function tamper(token: string): string {
  const dot = token.lastIndexOf(".");
  const sig = token.slice(dot + 1);
  const swapped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
  return `${token.slice(0, dot + 1)}${swapped}`;
}

/** One test database per block: the admin login allows 10 attempts per minute and IP. */
function useContext() {
  const holder: { ctx: TestContext } = { ctx: undefined as never };
  beforeAll(async () => {
    holder.ctx = await createTestContext();
  });
  afterAll(() => holder.ctx.close());
  return holder;
}

describe("better auth (P-027)", () => {
  describe("admin sessions", () => {
    const t = useContext();
    it("login answers token, expiresAt (8 h) and the admin; /admin/me checks the session", async () => {
      const admin = await t.ctx.createAdmin("moderator");
      const before = Date.now();
      const res = await t.ctx.req("POST", "/admin/auth/login", {
        body: { email: admin.email.toUpperCase(), password: admin.password },
      });
      expect(res.status).toBe(200);
      expect(res.json.admin).toEqual({
        id: admin.id,
        email: admin.email,
        role: "moderator",
        createdAt: expect.any(String),
      });
      expect(res.json.token).toContain(".");
      const ttl = new Date(res.json.expiresAt).getTime() - before;
      expect(ttl).toBeGreaterThan(8 * HOUR_MS - 60_000);
      expect(ttl).toBeLessThan(8 * HOUR_MS + 60_000);

      const me = await t.ctx.req("GET", "/admin/me", { token: res.json.token });
      expect(me.status).toBe(200);
      expect(me.json).toMatchObject({ id: admin.id, role: "moderator" });
    });

    it("keeps argon2id hashes from before Better Auth (Bun.password, credential account)", async () => {
      const hash = await Bun.password.hash("migrated-admin-password", {
        algorithm: "argon2id",
        memoryCost: 19_456,
        timeCost: 2,
      });
      const user = await t.ctx.db.user.create({
        data: {
          email: "migrated-admin@example.com",
          name: "migrated-admin",
          emailVerified: true,
          role: "admin",
        },
      });
      await t.ctx.db.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hash,
        },
      });
      const res = await t.ctx.req("POST", "/admin/auth/login", {
        body: {
          email: "migrated-admin@example.com",
          password: "migrated-admin-password",
        },
      });
      expect(res.status).toBe(200);
      expect(res.json.admin.role).toBe("admin");
    });

    it("wrong password, unknown e-mail and disabled accounts get 401 invalid_credentials", async () => {
      const root = await t.ctx.createAdmin("admin");
      const target = await t.ctx.createAdmin("moderator");
      for (const body of [
        { email: target.email, password: "wrong-password-123" },
        { email: "nobody@example.com", password: "whatever-12345" },
      ]) {
        const res = await t.ctx.req("POST", "/admin/auth/login", { body });
        expect(res.status).toBe(401);
        expect(res.json.error).toBe("invalid_credentials");
      }

      // Disabling ends the running session at once and blocks new logins.
      const disable = await t.ctx.req(
        "POST",
        `/admin/admins/${target.id}/disable`,
        { token: root.token }
      );
      expect(disable.status).toBe(200);
      expect(disable.json.disabledAt).toEqual(expect.any(String));
      const stale = await t.ctx.req("GET", "/admin/me", {
        token: target.token,
      });
      expect(stale.status).toBe(401);
      expect(stale.json.error).toBe("unauthorized");
      const login = await t.ctx.req("POST", "/admin/auth/login", {
        body: { email: target.email, password: target.password },
      });
      expect(login.status).toBe(401);
      expect(login.json.error).toBe("invalid_credentials");

      const enable = await t.ctx.req(
        "POST",
        `/admin/admins/${target.id}/enable`,
        { token: root.token }
      );
      expect(enable.json.disabledAt).toBeNull();
      const again = await t.ctx.req("POST", "/admin/auth/login", {
        body: { email: target.email, password: target.password },
      });
      expect(again.status).toBe(200);

      const audit = await t.ctx.req(
        "GET",
        `/admin/audit?targetId=${target.id}&actionPrefix=admin.`,
        { token: root.token }
      );
      expect(audit.json.items.map((e: { action: string }) => e.action)).toEqual(
        ["admin.enable", "admin.disable"]
      );
      expect(audit.json.items[0].adminEmail).toBe(root.email);
    });
  });

  describe("admin accounts", () => {
    const t = useContext();

    it("logout ends only this session", async () => {
      const admin = await t.ctx.createAdmin("admin");
      const second = await t.ctx.req("POST", "/admin/auth/login", {
        body: { email: admin.email, password: admin.password },
      });
      const out = await t.ctx.req("POST", "/admin/auth/logout", {
        token: admin.token,
      });
      expect(out.status).toBe(204);
      expect(
        (await t.ctx.req("GET", "/admin/me", { token: admin.token })).status
      ).toBe(401);
      expect(
        (await t.ctx.req("GET", "/admin/me", { token: second.json.token }))
          .status
      ).toBe(200);
      expect((await t.ctx.req("POST", "/admin/auth/logout")).status).toBe(401);
    });

    it("roles: moderators cannot manage admins; admins can create one that logs in", async () => {
      const root = await t.ctx.createAdmin("admin");
      const mod = await t.ctx.createAdmin("moderator");
      const body = {
        email: "new-moderator@example.com",
        password: "new-moderator-password",
        role: "moderator",
      };
      expect(
        (await t.ctx.req("POST", "/admin/admins", { token: mod.token, body }))
          .status
      ).toBe(403);
      const created = await t.ctx.req("POST", "/admin/admins", {
        token: root.token,
        body,
      });
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        email: body.email,
        role: "moderator",
        disabledAt: null,
      });
      const dup = await t.ctx.req("POST", "/admin/admins", {
        token: root.token,
        body,
      });
      expect(dup.status).toBe(409);
      expect(dup.json.error).toBe("email_taken");
      const login = await t.ctx.req("POST", "/admin/auth/login", {
        body: { email: body.email, password: body.password },
      });
      expect(login.status).toBe(200);
      const list = await t.ctx.req("GET", "/admin/admins", {
        token: root.token,
      });
      const emails = list.json.items.map((a: { email: string }) => a.email);
      expect(emails).toContain(body.email);
      // Player users never show up as admins.
      expect(emails.some((e: string) => e.endsWith(".invalid"))).toBe(false);
    });
  });

  describe("players", () => {
    const t = useContext();

    it("dev login: Better Auth session token valid 30 days on every player route", async () => {
      const before = Date.now();
      const login = await t.ctx.req("POST", "/auth/dev", {
        headers: { "x-dev-auth-key": DEV_KEY },
        body: { name: "Sitzung", deviceId: "dev-device-session-0001" },
      });
      expect(login.status).toBe(200);
      const { token, player } = login.json;
      expect(token).toContain(".");
      const ttl = new Date(login.json.expiresAt).getTime() - before;
      expect(ttl).toBeGreaterThan(30 * DAY_MS - 60_000);
      expect(ttl).toBeLessThan(30 * DAY_MS + 60_000);

      const routes: [string, string, unknown?][] = [
        ["GET", "/me"],
        ["GET", "/me/identities"],
        ["POST", "/me/link-code"],
        ["POST", "/me/deletion-code"],
        ["POST", "/guilds", { name: "Sitzungsgilde", tag: "SITZ" }],
        ["GET", "/guilds/me"],
        ["GET", "/guilds/me/progress"],
        ["GET", "/auth/token"],
      ];
      for (const [method, path, body] of routes) {
        const res = await t.ctx.req(method, path, { token, body });
        expect(res.status, `${method} ${path}`).toBeLessThan(300);
      }
      const run = await t.ctx.reportRun(token, { participants: [player.id] });
      expect(run.status).toBe(201);
      const board = await t.ctx.req("GET", "/leaderboards/solo", { token });
      expect(board.json.own).toMatchObject({ id: player.id });

      // The session belongs to the player: deleting the account ends it.
      expect((await t.ctx.req("DELETE", "/me", { token })).status).toBe(204);
      expect((await t.ctx.req("GET", "/me", { token })).status).toBe(401);
      expect(
        await t.ctx.db.user.count({ where: { playerId: player.id } })
      ).toBe(0);
    });

    it("rejects unsigned, tampered and foreign tokens", async () => {
      const p = await t.ctx.login();
      const raw = p.token.slice(0, p.token.lastIndexOf("."));
      for (const token of [raw, tamper(p.token), `${p.token}x`, "a.b"]) {
        expect((await t.ctx.req("GET", "/me", { token })).status).toBe(401);
      }
      expect((await t.ctx.req("GET", "/me", { token: p.token })).status).toBe(
        200
      );
    });

    it("player sessions never reach admin routes, admin sessions never player routes", async () => {
      const p = await t.ctx.login();
      const admin = await t.ctx.createAdmin("admin");
      for (const [method, path] of [
        ["GET", "/admin/me"],
        ["GET", "/admin/stats"],
        ["GET", "/admin/players"],
        ["GET", "/admin/admins"],
        ["GET", "/admin/audit"],
        ["POST", "/admin/auth/logout"],
      ] as const) {
        const res = await t.ctx.req(method, path, { token: p.token });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(res.json.error).toBe("unauthorized");
      }
      for (const [method, path] of [
        ["GET", "/me"],
        ["GET", "/auth/token"],
        ["GET", "/guilds/me"],
      ] as const) {
        const res = await t.ctx.req(method, path, { token: admin.token });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    });

    it("POST /me/link hands out a new working session; the removed account's session ends", async () => {
      const owner = await t.ctx.login();
      const other = await t.ctx.login();
      const code = await t.ctx.req("POST", "/me/link-code", {
        token: owner.token,
      });
      const link = await t.ctx.req("POST", "/me/link", {
        token: other.token,
        body: { code: code.json.code },
      });
      expect(link.status).toBe(200);
      expect(link.json.token).not.toBe(owner.token);
      const me = await t.ctx.req("GET", "/me", { token: link.json.token });
      expect(me.json.id).toBe(link.json.player.id);
      const removed =
        link.json.removedPlayerId === owner.id ? owner.token : other.token;
      expect((await t.ctx.req("GET", "/me", { token: removed })).status).toBe(
        401
      );
    });
  });

  describe("relay token (GET /auth/token)", () => {
    const t = useContext();

    it("issues an EdDSA JWT with sub, name, aud and 15 minutes, verifiable with the JWKS", async () => {
      const p = await t.ctx.login("Funkenflug");
      const before = Math.floor(Date.now() / 1000);
      const res = await t.ctx.req("GET", "/auth/token", { token: p.token });
      expect(res.status).toBe(200);
      const [header, payload] = res.json.token.split(".");
      expect(decodePart(header)).toMatchObject({
        alg: "EdDSA",
        kid: expect.any(String),
      });
      const claims = decodePart(payload);
      expect(claims).toMatchObject({
        sub: p.id,
        name: "Funkenflug",
        aud: PLAYER_JWT_AUDIENCE,
        iss: t.ctx.config.BETTER_AUTH_URL,
      });
      expect(Number(claims.exp) - Number(claims.iat)).toBe(
        PLAYER_JWT_TTL_SECONDS
      );
      expect(Number(claims.iat)).toBeGreaterThanOrEqual(before - 1);
      expect(new Date(res.json.expiresAt).getTime()).toBe(
        Number(claims.exp) * 1000
      );
      // Only player data in the token.
      expect(Object.keys(claims).sort()).toEqual(
        ["aud", "exp", "iat", "iss", "name", "sub"].sort()
      );

      const jwksRes = await t.ctx.app.request(PLAYER_JWKS_PATH);
      expect(jwksRes.headers.get("cache-control")).toContain("max-age");
      const jwks = (await jwksRes.json()) as {
        keys: Record<string, string>[];
      };
      expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519" });
      expect(JSON.stringify(jwks)).not.toContain('"d"');
      expect(await verifyEd25519(res.json.token, jwks)).toBe(true);
      expect(await verifyEd25519(`${res.json.token}x`, jwks)).toBe(false);
    });

    it("needs a player session; banned players get 403 banned", async () => {
      expect((await t.ctx.req("GET", "/auth/token")).status).toBe(401);
      const p = await t.ctx.login();
      await t.ctx.db.ban.create({
        data: { playerId: p.id, reason: "Relay-Test" },
      });
      const res = await t.ctx.req("GET", "/auth/token", { token: p.token });
      expect(res.status).toBe(403);
      expect(res.json).toMatchObject({
        error: "banned",
        reason: "Relay-Test",
        expiresAt: null,
      });
    });
  });
});
