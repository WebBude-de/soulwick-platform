import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTestContext, type TestContext } from "./helpers.ts";

/** "Mein Konto": admins and moderators change their own password and e-mail. */

const NEW_PASSWORD = "a-brand-new-password-42";

/**
 * One test database per block: the admin login allows 10 attempts per minute and IP, the own
 * account routes 10 requests per minute and IP.
 */
function useContext() {
  const holder: { ctx: TestContext } = { ctx: undefined as never };
  beforeAll(async () => {
    holder.ctx = await createTestContext();
  });
  afterAll(() => holder.ctx.close());
  return holder;
}

async function auditOf(ctx: TestContext, action: string, targetId: string) {
  return await ctx.db.auditLog.findMany({ where: { action, targetId } });
}

describe("admin own account", () => {
  describe("password", () => {
    const t = useContext();

    it("changes the password, ends the other sessions and keeps the current one", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const second = await ctx.req("POST", "/admin/auth/login", {
        body: { email: admin.email, password: admin.password },
      });
      expect(second.status).toBe(200);
      const before = await ctx.db.session.findMany({
        where: { userId: admin.id },
      });
      expect(before).toHaveLength(2);

      const res = await ctx.req("POST", "/admin/me/password", {
        token: admin.token,
        body: { currentPassword: admin.password, newPassword: NEW_PASSWORD },
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ revokedSessions: 1 });

      // The calling session stays with the same expiry, the other one is gone.
      expect(
        (await ctx.req("GET", "/admin/me", { token: admin.token })).status
      ).toBe(200);
      expect(
        (await ctx.req("GET", "/admin/me", { token: second.json.token })).status
      ).toBe(401);
      const after = await ctx.db.session.findMany({
        where: { userId: admin.id },
      });
      expect(after).toHaveLength(1);
      const kept = before.find((s) => s.id === after[0]?.id);
      expect(kept?.expiresAt.getTime()).toBe(after[0]?.expiresAt.getTime());

      expect(
        (
          await ctx.req("POST", "/admin/auth/login", {
            body: { email: admin.email, password: admin.password },
          })
        ).status
      ).toBe(401);
      expect(
        (
          await ctx.req("POST", "/admin/auth/login", {
            body: { email: admin.email, password: NEW_PASSWORD },
          })
        ).status
      ).toBe(200);

      const audit = await auditOf(ctx, "admin.password_change", admin.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.adminId).toBe(admin.id);
      expect(audit[0]?.targetType).toBe("admin_user");
      expect(audit[0]?.details).toEqual({ revokedSessions: 1 });
      const stored = JSON.stringify(audit[0]);
      expect(stored).not.toContain(admin.password);
      expect(stored).not.toContain(NEW_PASSWORD);
    });

    it("rejects a wrong current password, a too short and an unchanged new password", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const wrong = await ctx.req("POST", "/admin/me/password", {
        token: admin.token,
        body: {
          currentPassword: "not-the-password",
          newPassword: NEW_PASSWORD,
        },
      });
      expect(wrong.status).toBe(400);
      expect(wrong.json.error).toBe("invalid_current_password");

      const short = await ctx.req("POST", "/admin/me/password", {
        token: admin.token,
        body: { currentPassword: admin.password, newPassword: "too-short" },
      });
      expect(short.status).toBe(400);
      expect(short.json.error).toBe("validation_error");

      const same = await ctx.req("POST", "/admin/me/password", {
        token: admin.token,
        body: {
          currentPassword: admin.password,
          newPassword: admin.password,
        },
      });
      expect(same.status).toBe(400);
      expect(same.json.error).toBe("password_unchanged");

      // Nothing changed: the old password still works, nothing was audited.
      expect(
        (
          await ctx.req("POST", "/admin/auth/login", {
            body: { email: admin.email, password: admin.password },
          })
        ).status
      ).toBe(200);
      expect(await auditOf(ctx, "admin.password_change", admin.id)).toEqual([]);
    });

    it("moderators change their own password and e-mail too; players cannot", async () => {
      const { ctx } = t;
      const mod = await ctx.createAdmin("moderator");
      const pw = await ctx.req("POST", "/admin/me/password", {
        token: mod.token,
        body: { currentPassword: mod.password, newPassword: NEW_PASSWORD },
      });
      expect(pw.status).toBe(200);
      const email = `mod-${mod.id.slice(0, 8)}@example.com`;
      const mail = await ctx.req("POST", "/admin/me/email", {
        token: mod.token,
        body: { email, currentPassword: NEW_PASSWORD },
      });
      expect(mail.status).toBe(200);
      expect(mail.json).toMatchObject({ id: mod.id, email, role: "moderator" });

      const player = await ctx.login();
      const asPlayer = await ctx.req("POST", "/admin/me/password", {
        token: player.token,
        body: { currentPassword: "whatever", newPassword: NEW_PASSWORD },
      });
      expect(asPlayer.status).toBe(401);
    });
  });

  describe("e-mail", () => {
    const t = useContext();

    it("changes the e-mail (normalised), the panel sees it at once, sessions stay", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const newEmail = `renamed-${admin.id.slice(0, 8)}@example.com`;
      const res = await ctx.req("POST", "/admin/me/email", {
        token: admin.token,
        body: {
          email: `  ${newEmail.toUpperCase()} `,
          currentPassword: admin.password,
        },
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({
        id: admin.id,
        email: newEmail,
        role: "admin",
        createdAt: expect.any(String),
      });

      const me = await ctx.req("GET", "/admin/me", { token: admin.token });
      expect(me.status).toBe(200);
      expect(me.json.email).toBe(newEmail);

      expect(
        (
          await ctx.req("POST", "/admin/auth/login", {
            body: { email: admin.email, password: admin.password },
          })
        ).status
      ).toBe(401);
      expect(
        (
          await ctx.req("POST", "/admin/auth/login", {
            body: { email: newEmail, password: admin.password },
          })
        ).status
      ).toBe(200);

      const audit = await auditOf(ctx, "admin.email_change", admin.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.adminId).toBe(admin.id);
      expect(audit[0]?.details).toEqual({ from: admin.email, to: newEmail });
      expect(JSON.stringify(audit[0])).not.toContain(admin.password);
    });

    it("409 for a taken address (only with the right password), 400 for unchanged or invalid", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const other = await ctx.createAdmin("moderator");

      const taken = await ctx.req("POST", "/admin/me/email", {
        token: admin.token,
        body: { email: other.email, currentPassword: admin.password },
      });
      expect(taken.status).toBe(409);
      expect(taken.json.error).toBe("email_taken");

      // A wrong password never tells whether the address exists.
      const wrong = await ctx.req("POST", "/admin/me/email", {
        token: admin.token,
        body: { email: other.email, currentPassword: "not-the-password" },
      });
      expect(wrong.status).toBe(400);
      expect(wrong.json.error).toBe("invalid_current_password");

      const same = await ctx.req("POST", "/admin/me/email", {
        token: admin.token,
        body: { email: admin.email, currentPassword: admin.password },
      });
      expect(same.status).toBe(400);
      expect(same.json.error).toBe("email_unchanged");

      const invalid = await ctx.req("POST", "/admin/me/email", {
        token: admin.token,
        body: { email: "not-an-email", currentPassword: admin.password },
      });
      expect(invalid.status).toBe(400);
      expect(invalid.json.error).toBe("validation_error");

      const me = await ctx.req("GET", "/admin/me", { token: admin.token });
      expect(me.json.email).toBe(admin.email);
      expect(await auditOf(ctx, "admin.email_change", admin.id)).toEqual([]);
    });
  });

  describe("rate limits", () => {
    const t = useContext();

    it("5 wrong current passwords block the account (429), other accounts are not affected", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      for (let i = 0; i < 5; i += 1) {
        const res = await ctx.req("POST", "/admin/me/password", {
          token: admin.token,
          body: { currentPassword: `wrong-${i}`, newPassword: NEW_PASSWORD },
        });
        expect(res.status).toBe(400);
      }
      // Blocked even with the right password, on both routes.
      const blocked = await ctx.req("POST", "/admin/me/email", {
        token: admin.token,
        body: {
          email: "blocked@example.com",
          currentPassword: admin.password,
        },
      });
      expect(blocked.status).toBe(429);
      expect(blocked.json.error).toBe("rate_limited");

      const other = await ctx.createAdmin("moderator");
      const ok = await ctx.req("POST", "/admin/me/password", {
        token: other.token,
        body: { currentPassword: other.password, newPassword: NEW_PASSWORD },
      });
      expect(ok.status).toBe(200);
    });
  });

  describe("rate limit per IP", () => {
    const t = useContext();

    it("allows 10 requests per minute and IP across both routes", async () => {
      const { ctx } = t;
      const admin = await ctx.createAdmin("admin");
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const path = i % 2 === 0 ? "/admin/me/password" : "/admin/me/email";
        statuses.push(
          (await ctx.req("POST", path, { token: admin.token, body: {} })).status
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });
});
