/**
 * Creates (or resets the password and role of, and re-enables) an admin account in Better Auth
 * (P-027: auth_users + credential row in auth_accounts).
 *   bun run --cwd apps/api admin:create <email> <password> [admin|moderator]
 * In the Docker image: bun apps/api/src/scripts/create-admin.ts <email> <password> [role]
 */
import { AdminEmail, AdminPassword, AdminRole } from "@soulwick/contracts";
import { createPrisma } from "@soulwick/db";
import { saveAdminAccount } from "../services/admin-users.ts";

const [emailArg, passwordArg, roleArg = "admin"] = process.argv
  .slice(2)
  .filter((a) => a !== "--");
const email = AdminEmail.safeParse(emailArg);
const password = AdminPassword.safeParse(passwordArg);
const role = AdminRole.safeParse(roleArg);
if (!(email.success && password.success && role.success)) {
  console.error(
    "Usage: admin:create <email> <password (min. 12 characters)> [admin|moderator]"
  );
  process.exit(1);
}

const db = createPrisma(process.env.DATABASE_URL ?? "");
try {
  // Argon2 hashing takes longer than Prisma's default 5 s transaction timeout on slow machines.
  const row = await db.$transaction(
    (tx) =>
      saveAdminAccount(tx, {
        email: email.data,
        password: password.data,
        role: role.data,
        mode: "upsert",
      }),
    { timeout: 30_000 }
  );
  console.log(`Admin ready: ${row.email} (${row.role}, id ${row.id})`);
} finally {
  await db.$disconnect();
}
