import {
  AdminChangeEmailRequest,
  AdminChangePasswordRequest,
  AdminLoginRequest,
  AuditQuery,
  CreateAdminUserRequest,
  Uuid,
} from "@soulwick/contracts";
import type { Prisma } from "@soulwick/db";
import { Hono, type MiddlewareHandler } from "hono";
import { ApiError } from "../../lib/errors.ts";
import { fixedWindowCounter, rateLimit } from "../../lib/rate-limit.ts";
import { timeRangeFilter } from "../../lib/time-range.ts";
import { iso, parseBody, parseParam, parseQuery } from "../../lib/validate.ts";
import { requireAdmin, requireRole } from "../../middleware/auth.ts";
import {
  changeOwnEmail,
  changeOwnPassword,
} from "../../services/admin-account.ts";
import {
  createAdminUser,
  listAdminUsers,
  setAdminDisabled,
  signInAdmin,
  signOut,
  toAdminSelf,
} from "../../services/admin-users.ts";
import type { AppEnv, Deps } from "../../types.ts";
import { adminAccountDeletionRoutes } from "./account-deletions.ts";
import { adminGuildRoutes } from "./guilds.ts";
import { adminPlayerRoutes } from "./players.ts";
import { adminRelayRoutes } from "./relay.ts";
import { adminRunRoutes } from "./runs.ts";
import { adminStatsRoutes } from "./stats.ts";

/** TESTWERT: POST /admin/me/password|email per IP and minute (both routes together). */
const OWN_ACCOUNT_REQUESTS_PER_MINUTE = 10;
/** TESTWERT: wrong current passwords per account before both routes answer 429. */
const WRONG_PASSWORDS_PER_ACCOUNT = 5;
const WRONG_PASSWORD_WINDOW_MS = 15 * 60_000;

export function adminRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => deps.now?.() ?? new Date();

  // --- login (unauthenticated, extra strict rate limit against password guessing) -----------
  // Better Auth e-mail/password sign-in (P-027); the answer keeps the former AdminLoginResponse.
  app.post(
    "/auth/login",
    rateLimit({
      limit: 10,
      trustProxy: deps.config.TRUST_PROXY,
      name: "admin-login",
    }),
    async (c) => {
      const { email, password } = await parseBody(c, AdminLoginRequest);
      return c.json(await signInAdmin(deps, email, password));
    }
  );

  // --- everything below requires an admin session token --------------------------------------
  app.use("*", requireAdmin(deps));

  /** Ends the session of the sent token (the panel deletes its cookie as well). */
  app.post("/auth/logout", async (c) => {
    await signOut(deps, c.req.header("authorization"));
    return c.body(null, 204);
  });

  app.get("/me", (c) => c.json(toAdminSelf(c.get("admin"))));

  // --- own account ("Mein Konto"): every role, only for itself ------------------------------
  const ownAccountLimit = rateLimit({
    limit: OWN_ACCOUNT_REQUESTS_PER_MINUTE,
    trustProxy: deps.config.TRUST_PROXY,
    name: "admin-own-account",
  });
  const wrongPasswords = fixedWindowCounter({
    limit: WRONG_PASSWORDS_PER_ACCOUNT,
    windowMs: WRONG_PASSWORD_WINDOW_MS,
  });
  /** Blocks an account after too many wrong current passwords (guessing from a stolen session). */
  const passwordGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
    const retryAfter = wrongPasswords.blockedFor(c.get("admin").id);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new ApiError(429, "rate_limited", "Too many wrong passwords");
    }
    await next();
  };

  app.post("/me/password", ownAccountLimit, passwordGuard, async (c) => {
    const body = await parseBody(c, AdminChangePasswordRequest);
    const admin = c.get("admin");
    return c.json(
      await changeOwnPassword(deps.db, {
        admin,
        sessionId: c.get("adminSessionId"),
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        onWrongPassword: () => wrongPasswords.hit(admin.id),
      })
    );
  });

  app.post("/me/email", ownAccountLimit, passwordGuard, async (c) => {
    const body = await parseBody(c, AdminChangeEmailRequest);
    const admin = c.get("admin");
    return c.json(
      await changeOwnEmail(deps.db, {
        admin,
        email: body.email,
        currentPassword: body.currentPassword,
        onWrongPassword: () => wrongPasswords.hit(admin.id),
      })
    );
  });

  app.route("/stats", adminStatsRoutes(deps));
  app.route("/players", adminPlayerRoutes(deps));
  app.route("/guilds", adminGuildRoutes(deps));
  app.route("/runs", adminRunRoutes(deps));
  app.route("/account-deletions", adminAccountDeletionRoutes(deps));
  app.route("/relay", adminRelayRoutes(deps));

  app.get("/audit", async (c) => {
    const q = parseQuery(c, AuditQuery);
    const createdAt = timeRangeFilter(q.from, q.to);
    const action: Prisma.StringFilter = {
      ...(q.action ? { equals: q.action } : {}),
      ...(q.actionPrefix ? { startsWith: q.actionPrefix } : {}),
    };
    const where: Prisma.AuditLogWhereInput = {
      ...(q.adminId ? { adminId: q.adminId } : {}),
      ...(q.action || q.actionPrefix ? { action } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const rows = await deps.db.auditLog.findMany({
      where,
      include: { admin: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: q.limit,
      skip: q.offset,
    });
    const total = await deps.db.auditLog.count({ where });
    return c.json({
      items: rows.map((entry) => ({
        id: entry.id,
        adminId: entry.adminId,
        adminEmail: entry.admin?.email ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        details: entry.details,
        createdAt: iso(entry.createdAt),
      })),
      total,
    });
  });

  // --- admin users (role admin only) ----------------------------------------------------------
  const admins = new Hono<AppEnv>();
  admins.use("*", requireRole("admin"));

  admins.get("/", async (c) =>
    c.json({ items: await listAdminUsers(deps.db) })
  );

  admins.post("/", async (c) => {
    const body = await parseBody(c, CreateAdminUserRequest);
    return c.json(await createAdminUser(deps.db, c.get("admin").id, body), 201);
  });

  const setDisabled = (disabled: boolean) =>
    admins.post(`/:id/${disabled ? "disable" : "enable"}`, async (c) => {
      const id = parseParam(c, "id", Uuid);
      return c.json(
        await setAdminDisabled(deps.db, {
          actorId: c.get("admin").id,
          id,
          disabled,
          now: now(),
        })
      );
    });
  setDisabled(true);
  setDisabled(false);

  app.route("/admins", admins);
  return app;
}
