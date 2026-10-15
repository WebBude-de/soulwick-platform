import type {
  AdminChangePasswordResponse,
  AdminSelf,
} from "@soulwick/contracts";
import type { Db } from "@soulwick/db";
import { ApiError, isUniqueViolation, withCause } from "../lib/errors.ts";
import type { AdminAccount } from "../types.ts";
import { toAdminSelf } from "./admin-users.ts";
import { writeAudit } from "./audit.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

/**
 * The signed-in admin or moderator changes their own password or e-mail ("Mein Konto").
 * Implemented on the Better Auth tables directly instead of `auth.api.changePassword` /
 * `changeEmail`: Better Auth's `revokeOtherSessions` also ends the calling session and issues a
 * new token with a fresh lifetime, its change-email flow needs mail delivery and answers 200 for
 * taken addresses, and neither would write the audit entry in the same transaction. The hash and
 * verify functions are the ones Better Auth is configured with (passwords.ts).
 */

interface OwnAccountInput {
  admin: AdminAccount;
  currentPassword: string;
  /** Called on a wrong current password (counts towards the per-account limit). */
  onWrongPassword: () => void;
}

const invalidCurrentPassword = () =>
  new ApiError(400, "invalid_current_password", "Current password is wrong");

const emailTaken = () =>
  new ApiError(409, "email_taken", "An admin with this email exists");

/** The credential row after checking the current password; throws on a wrong one. */
async function checkCurrentPassword(db: Db, input: OwnAccountInput) {
  const account = await db.account.findFirst({
    where: { userId: input.admin.id, providerId: "credential" },
  });
  const ok = account?.password
    ? await verifyPassword(account.password, input.currentPassword)
    : false;
  if (!(account && ok)) {
    input.onWrongPassword();
    throw invalidCurrentPassword();
  }
  return account;
}

/**
 * POST /admin/me/password: new hash, all other sessions of the account ended and the audit entry
 * in one transaction. The calling session stays (same token and expiry).
 */
export async function changeOwnPassword(
  db: Db,
  input: OwnAccountInput & { sessionId: string; newPassword: string }
): Promise<AdminChangePasswordResponse> {
  const account = await checkCurrentPassword(db, input);
  if (input.newPassword === input.currentPassword) {
    throw new ApiError(
      400,
      "password_unchanged",
      "The new password equals the current one"
    );
  }
  // Hash outside the transaction: argon2id takes a moment.
  const passwordHash = await hashPassword(input.newPassword);
  const revokedSessions = await db.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: account.id },
      data: { password: passwordHash },
    });
    const { count } = await tx.session.deleteMany({
      where: { userId: input.admin.id, id: { not: input.sessionId } },
    });
    await writeAudit(tx, {
      adminId: input.admin.id,
      action: "admin.password_change",
      targetType: "admin_user",
      targetId: input.admin.id,
      details: { revokedSessions: count },
    });
    return count;
  });
  return { revokedSessions };
}

/**
 * POST /admin/me/email: the address is already normalised by `AdminEmail`. Taken addresses (admin
 * or player user) answer 409, but only after the password check, so the route does not reveal
 * which addresses exist. No confirmation mail (none is set up); sessions stay.
 */
export async function changeOwnEmail(
  db: Db,
  input: OwnAccountInput & { email: string }
): Promise<AdminSelf> {
  await checkCurrentPassword(db, input);
  const { admin, email } = input;
  if (email === admin.email.toLowerCase()) {
    throw new ApiError(
      400,
      "email_unchanged",
      "The new email equals the current one"
    );
  }
  try {
    const user = await db.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email } })) {
        throw emailTaken();
      }
      const row = await tx.user.update({
        where: { id: admin.id },
        data: { email },
      });
      await writeAudit(tx, {
        adminId: admin.id,
        action: "admin.email_change",
        targetType: "admin_user",
        targetId: admin.id,
        details: { from: admin.email, to: email },
      });
      return row;
    });
    return toAdminSelf({ ...admin, email: user.email });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw withCause(emailTaken(), err);
    }
    throw err;
  }
}
