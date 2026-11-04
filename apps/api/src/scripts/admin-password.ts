/**
 * Emergency script: sets the password of an admin or moderator account directly in the database,
 * for when nobody can log in to the admin panel any more. Ends all sessions of the account and
 * writes the audit entry `admin.password_reset` with `adminId` null and `source: "script"`.
 *
 *   bun run db:admin:password                        lists the admin accounts and exits
 *   ADMIN_NEW_PASSWORD=<new> bun run db:admin:password <email>
 *
 * The new password comes only from ADMIN_NEW_PASSWORD (never as an argument, so it stays out of
 * the shell history and process list) and is never printed. DATABASE_URL from the root .env.local
 * (or the environment, which wins). In the API container: `bun apps/api/src/scripts/admin-password.ts`.
 */
import { AdminEmail, AdminPassword } from "@soulwick/contracts";
import { createPrisma, type Db } from "@soulwick/db";
import { listAdminUsers, setAdminPassword } from "../services/admin-users.ts";

/** Local default of the env examples; never accepted in production. */
const LOCAL_DEFAULT_PASSWORD = "soulwick-admin-local";

export type AdminPasswordResult =
  /** No e-mail argument: the accounts were listed. */
  | "listed"
  /** Wrong arguments, invalid e-mail or password: nothing changed. */
  | "invalid"
  /** No admin account with this e-mail. */
  | "not_found"
  | "updated";

interface ScriptLog {
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const consoleLog: ScriptLog = {
  info: (msg) => console.log(msg),
  error: (msg) => console.error(msg),
};

async function listAccounts(db: Db, log: ScriptLog): Promise<void> {
  const admins = await listAdminUsers(db);
  if (admins.length === 0) {
    log.info("No admin accounts. Create one with `bun run db:seed`.");
    return;
  }
  log.info("Admin accounts (email, role, disabled):");
  for (const a of admins) {
    log.info(`  ${a.email}  ${a.role}  ${a.disabledAt ? "yes" : "no"}`);
  }
  log.info(
    "Set a password: ADMIN_NEW_PASSWORD=<new> bun run db:admin:password <email>"
  );
}

/** Lists the accounts (no arguments) or sets the password of the account `args[0]`. */
export async function runAdminPassword(
  db: Db,
  args: readonly string[],
  env: Record<string, string | undefined>,
  log: ScriptLog = consoleLog
): Promise<AdminPasswordResult> {
  if (args.length === 0) {
    await listAccounts(db, log);
    return "listed";
  }
  if (args.length > 1) {
    log.error(
      "Pass only the e-mail address; the new password comes from ADMIN_NEW_PASSWORD."
    );
    return "invalid";
  }
  const email = AdminEmail.safeParse(args[0]);
  if (!email.success) {
    log.error("The argument is not an e-mail address.");
    return "invalid";
  }
  const password = AdminPassword.safeParse(env.ADMIN_NEW_PASSWORD ?? "");
  if (!password.success) {
    log.error(
      "Set ADMIN_NEW_PASSWORD to the new password (12 to 256 characters); nothing changed."
    );
    return "invalid";
  }
  if (
    env.NODE_ENV === "production" &&
    password.data === LOCAL_DEFAULT_PASSWORD
  ) {
    log.error(
      "ADMIN_NEW_PASSWORD is the local default; refused in production, nothing changed."
    );
    return "invalid";
  }
  const target = (await listAdminUsers(db)).find((a) => a.email === email.data);
  if (!target) {
    log.error(
      `No admin account ${email.data}. Run without arguments to list them.`
    );
    return "not_found";
  }
  const { revokedSessions } = await setAdminPassword(db, {
    actorId: null,
    id: target.id,
    newPassword: password.data,
    source: "script",
  });
  log.info(
    `Password of ${target.email} (${target.role}) set; ${revokedSessions} session(s) ended.${target.disabledAt ? " The account is still disabled." : ""}`
  );
  return "updated";
}

if (import.meta.main) {
  let db: Db | undefined;
  try {
    db = createPrisma(process.env.DATABASE_URL ?? "");
    const result = await runAdminPassword(
      db,
      process.argv.slice(2),
      process.env
    );
    if (result === "invalid" || result === "not_found") {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(
      `admin-password failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
