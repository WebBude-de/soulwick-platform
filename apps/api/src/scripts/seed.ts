/**
 * Base seed: the admin account from DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD (like DapItUp).
 * Safe for every environment and idempotent: the account is only created while no user has this
 * e-mail; an existing account is never changed (no password reset, no role change, no enabling).
 * Without the variables it prints a hint and exits 0. Later it can hold more base data.
 *
 *   bun run db:seed                           (repo root; DATABASE_URL from the root .env.local)
 *   In the Docker image it runs on every container start, after the migrations (apps/api/Dockerfile).
 *
 * The dev seed (seed-dev.ts) is separate: test data, refuses production.
 */
import { AdminEmail, AdminPassword } from "@soulwick/contracts";
import { createPrisma, type Db } from "@soulwick/db";
import { ApiError, isUniqueViolation } from "../lib/errors.ts";
import { createAdminAccount } from "../services/admin-users.ts";
import { writeAudit } from "../services/audit.ts";

/** Local default of the env examples and the dev seed; never accepted in production. */
const LOCAL_DEFAULT_PASSWORD = "soulwick-admin-local";

export type SeedAdminResult =
  /** No DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD: nothing to do. */
  | "not_configured"
  /** A variable is invalid (or the local default password in production): nothing created. */
  | "invalid"
  /** A user with this e-mail exists: left as it is. */
  | "exists"
  /** The address was changed away under "Mein Konto": not created again. */
  | "email_changed"
  | "created";

interface SeedLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const consoleLog: SeedLog = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
};

/**
 * Creates the seed admin (role admin) with an `admin.create` audit entry (`source: "seed"`) in
 * one transaction, unless a user with that e-mail exists.
 */
export async function seedAdmin(
  db: Db,
  env: Record<string, string | undefined>,
  log: SeedLog = consoleLog
): Promise<SeedAdminResult> {
  const rawEmail = env.DEFAULT_ADMIN_EMAIL?.trim() ?? "";
  const rawPassword = env.DEFAULT_ADMIN_PASSWORD ?? "";
  if (!(rawEmail || rawPassword)) {
    log.info(
      "Seed admin: DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD not set, nothing to do."
    );
    return "not_configured";
  }
  const email = AdminEmail.safeParse(rawEmail);
  if (!email.success) {
    log.warn("Seed admin: DEFAULT_ADMIN_EMAIL is missing or not an e-mail.");
    return "invalid";
  }

  if (await db.user.findUnique({ where: { email: email.data } })) {
    log.info(`Seed admin: ${email.data} exists, left unchanged.`);
    return "exists";
  }
  const changedAway = await db.auditLog.findFirst({
    where: {
      action: "admin.email_change",
      details: { path: ["from"], equals: email.data },
    },
  });
  if (changedAway) {
    log.warn(
      `Seed admin: ${email.data} was changed to another address under "Mein Konto"; not created again. Remove DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD.`
    );
    return "email_changed";
  }

  const password = AdminPassword.safeParse(rawPassword);
  if (!password.success) {
    log.warn(
      "Seed admin: DEFAULT_ADMIN_PASSWORD is missing or shorter than 12 characters; no admin created."
    );
    return "invalid";
  }
  if (
    env.NODE_ENV === "production" &&
    password.data === LOCAL_DEFAULT_PASSWORD
  ) {
    log.warn(
      "Seed admin: DEFAULT_ADMIN_PASSWORD is the local default; refused in production, no admin created."
    );
    return "invalid";
  }

  try {
    // Argon2 hashing can take longer than Prisma's default 5 s transaction timeout.
    await db.$transaction(
      async (tx) => {
        const user = await createAdminAccount(tx, {
          email: email.data,
          password: password.data,
          role: "admin",
        });
        await writeAudit(tx, {
          adminId: user.id,
          action: "admin.create",
          targetType: "admin_user",
          targetId: user.id,
          details: { email: user.email, role: user.role, source: "seed" },
        });
      },
      { timeout: 30_000 }
    );
  } catch (err) {
    // Another container created it at the same moment.
    if (
      isUniqueViolation(err) ||
      (err instanceof ApiError && err.code === "email_taken")
    ) {
      log.info(`Seed admin: ${email.data} exists, left unchanged.`);
      return "exists";
    }
    throw err;
  }
  log.info(
    `Seed admin: ${email.data} created (role admin). Change the password under "Mein Konto" after the first login.`
  );
  return "created";
}

if (import.meta.main) {
  let db: Db | undefined;
  try {
    db = createPrisma(process.env.DATABASE_URL ?? "");
    await seedAdmin(db, process.env);
  } catch (err) {
    console.error(
      `Base seed failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
