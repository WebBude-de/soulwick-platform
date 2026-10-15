import type {
  AdminLoginResponse,
  AdminRole,
  AdminSelf,
  AdminUser as AdminUserDto,
} from "@soulwick/contracts";
import type { Db, User } from "@soulwick/db";
import { isAPIError } from "better-auth/api";
import {
  ApiError,
  isUniqueViolation,
  notFound,
  withCause,
} from "../lib/errors.ts";
import { iso, isoOrNull } from "../lib/validate.ts";
import type { AdminAccount, Deps } from "../types.ts";
import { writeAudit } from "./audit.ts";
import type { DbOrTx } from "./db-types.ts";
import { hashPassword } from "./passwords.ts";
import {
  bearerHeaders,
  sessionFromAuthorization,
  sessionTokenFromHeaders,
} from "./sessions.ts";

/**
 * Admin and moderator accounts on Better Auth (P-027): users with role `admin` or `moderator`,
 * no player id, a credential account with the argon2id hash. Disabled accounts are `banned`
 * (Better Auth refuses new sessions) and keep `disabled_at` for the panel.
 */
export const ADMIN_ROLES: readonly AdminRole[] = ["admin", "moderator"];

const isAdminRole = (role: unknown): role is AdminRole =>
  ADMIN_ROLES.includes(role as AdminRole);

interface SessionUser {
  banned?: boolean | null;
  createdAt: Date;
  email: string;
  id: string;
  playerId?: string | null;
  role?: string | null;
}

/** The admin behind a session user, or null for players, unknown roles and disabled accounts. */
export function toAdminAccount(user: SessionUser): AdminAccount | null {
  if (user.playerId || user.banned || !isAdminRole(user.role)) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: new Date(user.createdAt),
  };
}

export const toAdminSelf = (a: AdminAccount): AdminSelf => ({
  id: a.id,
  email: a.email,
  role: a.role,
  createdAt: iso(a.createdAt),
});

const adminWhere = { role: { in: [...ADMIN_ROLES] }, playerId: null };

function toAdminUserDto(u: User): AdminUserDto {
  return {
    id: u.id,
    email: u.email,
    role: isAdminRole(u.role) ? u.role : "moderator",
    createdAt: iso(u.createdAt),
    disabledAt: isoOrNull(u.disabledAt),
  };
}

const invalidCredentials = () =>
  new ApiError(401, "invalid_credentials", "Email or password wrong");

/** The admin of a bearer token, or null (no, expired or ended session, player, disabled). */
export async function adminFromAuthorization(
  deps: Deps,
  authorization: string | undefined
): Promise<AdminAccount | null> {
  const session = await sessionFromAuthorization(deps, authorization);
  return session ? toAdminAccount(session.user) : null;
}

/**
 * POST /admin/auth/login through Better Auth's e-mail/password sign-in. Unknown e-mail, wrong
 * password and disabled accounts all answer 401 `invalid_credentials` (Better Auth hashes the
 * password for unknown e-mails too, so the timing does not tell them apart).
 */
export async function signInAdmin(
  deps: Deps,
  email: string,
  password: string
): Promise<AdminLoginResponse> {
  let token: string;
  try {
    const { headers } = await deps.auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      returnHeaders: true,
    });
    token = sessionTokenFromHeaders(headers);
  } catch (err) {
    if (isAPIError(err)) {
      throw withCause(invalidCredentials(), err);
    }
    throw err;
  }
  const authorization = `Bearer ${token}`;
  const session = await sessionFromAuthorization(deps, authorization);
  const admin = session ? toAdminAccount(session.user) : null;
  if (!(session && admin)) {
    // A user without an admin role (cannot happen today: players have no password).
    await signOut(deps, authorization);
    throw invalidCredentials();
  }
  return {
    token,
    expiresAt: iso(session.session.expiresAt),
    admin: toAdminSelf(admin),
  };
}

/** Ends the session of this bearer token (POST /admin/auth/logout). */
export async function signOut(
  deps: Deps,
  authorization: string | undefined
): Promise<void> {
  await deps.auth.api.signOut({ headers: bearerHeaders(authorization) });
}

export async function listAdminUsers(db: Db): Promise<AdminUserDto[]> {
  const rows = await db.user.findMany({
    where: adminWhere,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toAdminUserDto);
}

/**
 * Creates or updates an admin account with a credential row (Better Auth: `provider_id`
 * `credential`, `account_id` = user id). Refuses e-mails of player users. For POST /admin/admins
 * (`create` only), `admin:create` and the dev seed (`upsert`: new password, role, enabled again).
 */
export async function saveAdminAccount(
  tx: DbOrTx,
  input: {
    email: string;
    password: string;
    role: AdminRole;
    mode: "create" | "upsert";
  }
): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const existing = await tx.user.findUnique({ where: { email: input.email } });
  if (existing) {
    if (input.mode === "create" || existing.playerId) {
      throw new ApiError(409, "email_taken", "An admin with this email exists");
    }
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        role: input.role,
        banned: false,
        banReason: null,
        banExpires: null,
        disabledAt: null,
      },
    });
    const updated = await tx.account.updateMany({
      where: { userId: user.id, providerId: "credential" },
      data: { password: passwordHash },
    });
    if (updated.count === 0) {
      await tx.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });
    }
    return user;
  }
  const user = await tx.user.create({
    data: {
      email: input.email,
      name: input.email.split("@")[0] ?? input.email,
      emailVerified: true,
      role: input.role,
    },
  });
  await tx.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash,
    },
  });
  return user;
}

/** POST /admin/admins: new account and audit entry in one transaction. */
export async function createAdminUser(
  db: Db,
  actorId: string,
  input: { email: string; password: string; role: AdminRole }
): Promise<AdminUserDto> {
  try {
    const created = await db.$transaction(async (tx) => {
      const user = await saveAdminAccount(tx, { ...input, mode: "create" });
      await writeAudit(tx, {
        adminId: actorId,
        action: "admin.create",
        targetType: "admin_user",
        targetId: user.id,
        details: { email: user.email, role: user.role },
      });
      return user;
    });
    return toAdminUserDto(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw withCause(
        new ApiError(409, "email_taken", "An admin with this email exists"),
        err
      );
    }
    throw err;
  }
}

/**
 * POST /admin/admins/:id/disable|enable. Disabling bans the user for Better Auth and ends all
 * its sessions in the same transaction as the audit entry, so the account loses access at once.
 */
export async function setAdminDisabled(
  db: Db,
  input: { actorId: string; id: string; disabled: boolean; now: Date }
): Promise<AdminUserDto> {
  const { actorId, id, disabled, now } = input;
  if (id === actorId) {
    throw new ApiError(
      400,
      "cannot_change_self",
      "You cannot disable yourself"
    );
  }
  const target = await db.user.findFirst({ where: { id, ...adminWhere } });
  if (!target) {
    throw notFound("Admin user");
  }
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id },
      data: disabled
        ? { banned: true, banReason: "disabled", disabledAt: now }
        : {
            banned: false,
            banReason: null,
            banExpires: null,
            disabledAt: null,
          },
    });
    if (disabled) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    await writeAudit(tx, {
      adminId: actorId,
      action: disabled ? "admin.disable" : "admin.enable",
      targetType: "admin_user",
      targetId: id,
      details: { email: target.email },
    });
    return row;
  });
  return toAdminUserDto(updated);
}
