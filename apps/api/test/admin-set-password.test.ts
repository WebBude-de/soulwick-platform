import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runAdminPassword } from "../src/scripts/admin-password.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

/**
 * New password for another admin account: POST /admin/admins/:id/password (role admin) and the
 * emergency script `admin-password.ts` (`bun run db:admin:password`).
 */

const NEW_PASSWORD = "a-reset-password-for-you-7";
const SCRIPT = fileURLToPath(
  new URL("../src/scripts/admin-password.ts", import.meta.url)
);

/** One test database per block: the route allows 10 requests per minute and IP. */
function useContext() {
  const holder: { ctx: TestContext } = { ctx: undefined as never };
  beforeAll(async () => {
    holder.ctx = await createTestContext();
  });
  afterAll(() => holder.ctx.close());
  return holder;
}

function recorder() {
  const lines: { level: "info" | "error"; msg: string }[] = [];
  return {
    lines,
    text: () => lines.map((l) => l.msg).join("\n"),
    log: {
      info: (msg: string) => lines.push({ level: "info", msg }),
      error: (msg: string) => lines.push({ level: "error", msg }),
    },
  };
}

async function canLogin(ctx: TestContext, email: string, password: string) {
  const res = await ctx.req("POST", "/admin/auth/login", {
    body: { email, password },
  });
  return res.status === 200;
}

const resetAudit = (ctx: TestContext, targetId: string) =>
  ctx.db.auditLog.findMany({
    where: { action: "admin.password_reset", targetId },
  });

describe("POST /admin/admins/:id/password", () => {
  describe("happy path", () => {
    const t = useContext();

    it("sets the password, ends all sessions of the target and writes the audit", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const target = await ctx.createAdmin("moderator");
      expect(await canLogin(ctx, target.email, target.password)).toBe(true);

      const res = await ctx.req("POST", `/admin/admins/${target.id}/password`, {
        token: admin.token,
        body: { newPassword: NEW_PASSWORD },
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ revokedSessions: 2 });

      expect(
        (await ctx.req("GET", "/admin/me", { token: target.token })).status
      ).toBe(401);
      expect(await ctx.db.session.count({ where: { userId: target.id } })).toBe(
        0
      );
      // The calling admin keeps its session.
      expect(
        (await ctx.req("GET", "/admin/me", { token: admin.token })).status
      ).toBe(200);
      expect(await canLogin(ctx, target.email, target.password)).toBe(false);
      expect(await canLogin(ctx, target.email, NEW_PASSWORD)).toBe(true);

      const audit = await resetAudit(ctx, target.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.adminId).toBe(admin.id);
      expect(audit[0]?.targetType).toBe("admin_user");
      expect(audit[0]?.details).toEqual({
        email: target.email,
        revokedSessions: 2,
      });
      expect(JSON.stringify(audit[0]?.details)).not.toContain(NEW_PASSWORD);
    });

    it("keeps a disabled account disabled", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const target = await ctx.createAdmin("admin");
      const disabled = await ctx.req(
        "POST",
        `/admin/admins/${target.id}/disable`,
        { token: admin.token }
      );
      expect(disabled.status).toBe(200);

      const res = await ctx.req("POST", `/admin/admins/${target.id}/password`, {
        token: admin.token,
        body: { newPassword: NEW_PASSWORD },
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ revokedSessions: 0 });
      expect(await canLogin(ctx, target.email, NEW_PASSWORD)).toBe(false);
      const user = await ctx.db.user.findUnique({ where: { id: target.id } });
      expect(user?.disabledAt).not.toBeNull();
    });
  });

  describe("errors", () => {
    const t = useContext();

    it("answers 400, 401, 403 and 404 with stable codes", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const moderator = await ctx.createAdmin("moderator");
      const target = await ctx.createAdmin("moderator");
      const player = await ctx.login();
      const playerUser = await ctx.db.user.findFirst({
        where: { playerId: player.id },
      });
      const set = (id: string, body: unknown, token = admin.token) =>
        ctx.req("POST", `/admin/admins/${id}/password`, { token, body });
      const good = { newPassword: NEW_PASSWORD };

      const self = await set(admin.id, good);
      expect(self.status).toBe(400);
      expect(self.json.error).toBe("cannot_change_self");

      const short = await set(target.id, { newPassword: "too-short" });
      expect(short.status).toBe(400);
      expect(short.json.error).toBe("validation_error");

      const missing = await set(target.id, {});
      expect(missing.status).toBe(400);
      expect(missing.json.error).toBe("validation_error");

      expect((await set(randomUUID(), good)).json.error).toBe("not_found");
      expect((await set("not-a-uuid", good)).status).toBe(404);
      if (playerUser) {
        const asPlayer = await set(playerUser.id, good);
        expect(asPlayer.status).toBe(404);
        expect(asPlayer.json.error).toBe("not_found");
      }

      const byModerator = await set(target.id, good, moderator.token);
      expect(byModerator.status).toBe(403);
      expect(byModerator.json.error).toBe("forbidden");

      const anonymous = await ctx.req(
        "POST",
        `/admin/admins/${target.id}/password`,
        { body: good }
      );
      expect(anonymous.status).toBe(401);

      // Nothing changed.
      expect(await canLogin(ctx, target.email, target.password)).toBe(true);
      expect(await resetAudit(ctx, target.id)).toHaveLength(0);
    });
  });

  describe("rate limit", () => {
    const t = useContext();

    it("answers 429 after 10 requests per minute and IP", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const target = await ctx.createAdmin("moderator");
      const send = () =>
        ctx.req("POST", `/admin/admins/${target.id}/password`, {
          token: admin.token,
          body: { newPassword: "short" },
        });
      for (let i = 0; i < 10; i += 1) {
        expect((await send()).status).toBe(400);
      }
      const limited = await send();
      expect(limited.status).toBe(429);
      expect(limited.json.error).toBe("rate_limited");
    });
  });
});

describe("admin-password script", () => {
  const t = useContext();

  it("lists the admin accounts without an argument", async () => {
    const { ctx } = t;
    const admin = await ctx.createAdmin("admin");
    const moderator = await ctx.createAdmin("moderator");
    await ctx.req("POST", `/admin/admins/${moderator.id}/disable`, {
      token: admin.token,
    });
    const r = recorder();
    expect(await runAdminPassword(ctx.db, [], {}, r.log)).toBe("listed");
    expect(r.text()).toContain(`${admin.email}  admin  no`);
    expect(r.text()).toContain(`${moderator.email}  moderator  yes`);
  });

  it("refuses wrong arguments, missing passwords and unknown accounts", async () => {
    const { ctx } = t;
    const target = await ctx.createAdmin("admin");
    const env = { ADMIN_NEW_PASSWORD: NEW_PASSWORD };
    const run = (args: string[], e: Record<string, string> = env) =>
      runAdminPassword(ctx.db, args, e, recorder().log);

    expect(await run([target.email, NEW_PASSWORD])).toBe("invalid");
    expect(await run(["no-email"])).toBe("invalid");
    expect(await run([target.email], {})).toBe("invalid");
    expect(await run([target.email], { ADMIN_NEW_PASSWORD: "too-short" })).toBe(
      "invalid"
    );
    expect(
      await run([target.email], {
        ADMIN_NEW_PASSWORD: "soulwick-admin-local",
        NODE_ENV: "production",
      })
    ).toBe("invalid");
    expect(await run(["nobody@example.com"])).toBe("not_found");

    expect(await canLogin(ctx, target.email, target.password)).toBe(true);
    expect(await resetAudit(ctx, target.id)).toHaveLength(0);
  });

  it("sets the password by e-mail, ends the sessions and audits with source script", async () => {
    const { ctx } = t;
    const target = await ctx.createAdmin("admin");
    const r = recorder();
    const result = await runAdminPassword(
      ctx.db,
      [` ${target.email.toUpperCase()} `],
      { ADMIN_NEW_PASSWORD: NEW_PASSWORD },
      r.log
    );
    expect(result).toBe("updated");
    expect(r.text()).not.toContain(NEW_PASSWORD);
    expect(
      (await ctx.req("GET", "/admin/me", { token: target.token })).status
    ).toBe(401);
    expect(await canLogin(ctx, target.email, NEW_PASSWORD)).toBe(true);

    const audit = await resetAudit(ctx, target.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.adminId).toBeNull();
    expect(audit[0]?.details).toEqual({
      email: target.email,
      revokedSessions: 1,
      source: "script",
    });
  });

  it("runs as a script: lists, sets and never prints the password", async () => {
    const { ctx } = t;
    const target = await ctx.createAdmin("moderator");
    const password = "script-reset-password-9";
    const base = {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      DATABASE_URL: ctx.databaseUrl,
    };
    // cwd outside the repo: Bun would otherwise load the developer's .env.
    const run = async (args: string[], env: Record<string, string> = {}) => {
      const proc = Bun.spawn([process.execPath, SCRIPT, ...args], {
        cwd: tmpdir(),
        env: { ...base, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      const out =
        (await new Response(proc.stdout).text()) +
        (await new Response(proc.stderr).text());
      return { code, out };
    };

    const listed = await run([]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain(target.email);

    const noPassword = await run([target.email]);
    expect(noPassword.code).toBe(1);
    expect(noPassword.out).toContain("ADMIN_NEW_PASSWORD");

    const set = await run([target.email], { ADMIN_NEW_PASSWORD: password });
    expect(set.code).toBe(0);
    expect(set.out).not.toContain(password);
    expect(await canLogin(ctx, target.email, password)).toBe(true);
  });
});
