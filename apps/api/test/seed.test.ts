import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { seedAdmin } from "../src/scripts/seed.ts";
import { createAdminAccount } from "../src/services/admin-users.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

/** Base seed (`bun run db:seed`, every API container start): admin from DEFAULT_ADMIN_*. */

const SEED_SCRIPT = fileURLToPath(
  new URL("../src/scripts/seed.ts", import.meta.url)
);
const PASSWORD = "seed-admin-password-1";

function recorder() {
  const lines: { level: "info" | "warn"; msg: string }[] = [];
  return {
    lines,
    log: {
      info: (msg: string) => lines.push({ level: "info", msg }),
      warn: (msg: string) => lines.push({ level: "warn", msg }),
    },
  };
}

async function credentialHash(ctx: TestContext, userId: string) {
  const account = await ctx.db.account.findFirst({
    where: { userId, providerId: "credential" },
  });
  return account?.password ?? null;
}

describe("base seed", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("does nothing without the variables", async () => {
    const before = await ctx.db.user.count();
    const r = recorder();
    expect(await seedAdmin(ctx.db, {}, r.log)).toBe("not_configured");
    expect(
      await seedAdmin(
        ctx.db,
        { DEFAULT_ADMIN_EMAIL: " ", DEFAULT_ADMIN_PASSWORD: "" },
        r.log
      )
    ).toBe("not_configured");
    expect(await ctx.db.user.count()).toBe(before);
    expect(r.lines.every((l) => l.level === "info")).toBe(true);
  });

  it("creates the admin when the e-mail is missing, with an audit entry", async () => {
    const r = recorder();
    const result = await seedAdmin(
      ctx.db,
      {
        DEFAULT_ADMIN_EMAIL: " Seed-Admin@Example.com ",
        DEFAULT_ADMIN_PASSWORD: PASSWORD,
      },
      r.log
    );
    expect(result).toBe("created");
    const user = await ctx.db.user.findUnique({
      where: { email: "seed-admin@example.com" },
    });
    expect(user?.role).toBe("admin");
    expect(user?.banned).toBe(false);

    const login = await ctx.req("POST", "/admin/auth/login", {
      body: { email: "seed-admin@example.com", password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(login.json.admin.role).toBe("admin");

    const audit = await ctx.db.auditLog.findMany({
      where: { action: "admin.create", targetId: user?.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toEqual({
      email: "seed-admin@example.com",
      role: "admin",
      source: "seed",
    });
    expect(JSON.stringify(audit[0])).not.toContain(PASSWORD);
  });

  it("never changes an existing account (password hash, role, disabled)", async () => {
    const existing = await createAdminAccount(ctx.db, {
      email: "kept@example.com",
      password: "original-password-1",
      role: "moderator",
    });
    await ctx.db.user.update({
      where: { id: existing.id },
      data: { banned: true, disabledAt: new Date() },
    });
    const hashBefore = await credentialHash(ctx, existing.id);

    const r = recorder();
    expect(
      await seedAdmin(
        ctx.db,
        {
          DEFAULT_ADMIN_EMAIL: "kept@example.com",
          DEFAULT_ADMIN_PASSWORD: "another-password-2",
        },
        r.log
      )
    ).toBe("exists");
    const after = await ctx.db.user.findUnique({ where: { id: existing.id } });
    expect(after?.role).toBe("moderator");
    expect(after?.banned).toBe(true);
    expect(await credentialHash(ctx, existing.id)).toBe(hashBefore);
    expect(
      await ctx.db.auditLog.count({ where: { targetId: existing.id } })
    ).toBe(0);
  });

  it("warns and creates nothing for invalid values or the local default in production", async () => {
    const before = await ctx.db.user.count();
    const r = recorder();
    expect(
      await seedAdmin(
        ctx.db,
        {
          DEFAULT_ADMIN_EMAIL: "not-an-email",
          DEFAULT_ADMIN_PASSWORD: PASSWORD,
        },
        r.log
      )
    ).toBe("invalid");
    expect(
      await seedAdmin(
        ctx.db,
        {
          DEFAULT_ADMIN_EMAIL: "short@example.com",
          DEFAULT_ADMIN_PASSWORD: "short",
        },
        r.log
      )
    ).toBe("invalid");
    expect(
      await seedAdmin(
        ctx.db,
        { DEFAULT_ADMIN_EMAIL: "nopass@example.com" },
        r.log
      )
    ).toBe("invalid");
    expect(
      await seedAdmin(
        ctx.db,
        {
          NODE_ENV: "production",
          DEFAULT_ADMIN_EMAIL: "prod@example.com",
          DEFAULT_ADMIN_PASSWORD: "soulwick-admin-local",
        },
        r.log
      )
    ).toBe("invalid");
    expect(await ctx.db.user.count()).toBe(before);
    expect(r.lines.filter((l) => l.level === "warn")).toHaveLength(4);
  });

  it("does not create the address again after it was changed under Mein Konto", async () => {
    const env = {
      DEFAULT_ADMIN_EMAIL: "moved@example.com",
      DEFAULT_ADMIN_PASSWORD: PASSWORD,
    };
    const r = recorder();
    expect(await seedAdmin(ctx.db, env, r.log)).toBe("created");
    const login = await ctx.req("POST", "/admin/auth/login", {
      body: { email: "moved@example.com", password: PASSWORD },
    });
    const changed = await ctx.req("POST", "/admin/me/email", {
      token: login.json.token,
      body: { email: "moved-on@example.com", currentPassword: PASSWORD },
    });
    expect(changed.status).toBe(200);

    expect(await seedAdmin(ctx.db, env, r.log)).toBe("email_changed");
    expect(
      await ctx.db.user.findUnique({ where: { email: "moved@example.com" } })
    ).toBeNull();
  });

  it("the script exits 0 without variables and creates the admin with them", async () => {
    const base = {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      DATABASE_URL: ctx.databaseUrl,
    };
    // cwd outside the repo: Bun would otherwise load the developer's .env.local.
    const run = (env: Record<string, string>) =>
      Bun.spawn([process.execPath, SEED_SCRIPT], {
        cwd: tmpdir(),
        env: { ...base, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });

    const without = run({});
    expect(await without.exited).toBe(0);
    expect(await new Response(without.stdout).text()).toContain("not set");

    const withVars = run({
      DEFAULT_ADMIN_EMAIL: "script@example.com",
      DEFAULT_ADMIN_PASSWORD: PASSWORD,
    });
    expect(await withVars.exited).toBe(0);
    expect(
      await ctx.db.user.findUnique({ where: { email: "script@example.com" } })
    ).not.toBeNull();

    const again = run({
      DEFAULT_ADMIN_EMAIL: "script@example.com",
      DEFAULT_ADMIN_PASSWORD: "different-password-3",
    });
    expect(await again.exited).toBe(0);
    expect(await new Response(again.stdout).text()).toContain("unchanged");
  });
});
