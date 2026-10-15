import {
  PLAYER_JWT_AUDIENCE,
  PLAYER_JWT_TTL_SECONDS,
} from "@soulwick/contracts";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer, jwt } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { hashPassword, verifyPassword } from "../services/passwords.ts";
import type { BaseDeps } from "../types.ts";
import {
  PLAYER_ROLE,
  type SoulwickPlayerAuthOptions,
  soulwickPlayerAuth,
} from "./player-plugin.ts";

/** TESTWERT: a JWT signing key is used this long, then a new one is created. */
const JWKS_ROTATION_SECONDS = 30 * 86_400;
/**
 * TESTWERT: how long a rotated key stays in GET /auth/jwks. Must exceed the JWT lifetime; the
 * relay refetches the key set when it meets an unknown `kid`.
 */
const JWKS_GRACE_SECONDS = 2 * 86_400;

/**
 * Roles of the admin plugin. Soulwick checks admin and moderator rights itself in
 * middleware/auth.ts (`requireAdmin`, `requireRole`); these definitions only tell Better Auth
 * which role names exist. Only `admin` counts as an admin for Better Auth's own admin endpoints,
 * which are not reachable over HTTP anyway (the handler is not mounted, see app.ts).
 */
const ac = createAccessControl(defaultStatements);
const roles = {
  admin: adminAc,
  moderator: ac.newRole({ user: [], session: [] }),
  [PLAYER_ROLE]: ac.newRole({ user: [], session: [] }),
};

/**
 * The Better Auth instance of the API (P-027): e-mail/password for admins and moderators, the
 * admin plugin for roles and disabled accounts, the bearer plugin (session token as
 * `Authorization: Bearer`), the jwt plugin (short-lived player JWTs for the relay, JWKS) and
 * `soulwickPlayerAuth` (platform logins of players).
 *
 * Better Auth runs as a library: no `auth.handler` is mounted. Every HTTP path is an explicit Hono
 * route that validates with @soulwick/contracts and calls `auth.api.*`, so no endpoint (sign-up,
 * update-user, impersonation, ...) is exposed by accident and all error codes stay as they were.
 */
export function createAuth(
  deps: BaseDeps,
  player: Omit<SoulwickPlayerAuthOptions, "sessionTtlSeconds">
) {
  const { config } = deps;
  return betterAuth({
    appName: "Soulwick",
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/auth",
    secret: config.BETTER_AUTH_SECRET,
    database: prismaAdapter(deps.db, { provider: "postgresql" }),
    telemetry: { enabled: false },
    // Hono's rate limiter guards the routes; Better Auth's only sees its own handler.
    rateLimit: { enabled: false },
    logger: {
      disabled: config.LOG_LEVEL === "silent",
      level: "error",
    },
    advanced: {
      database: { generateId: "uuid" },
      // No IP addresses in sessions (privacy; the admin panel calls from its server anyway).
      ipAddress: { disableIpTracking: true },
    },
    emailAndPassword: {
      enabled: true,
      // Admins are created by admins (POST /admin/admins) or the seeds, never by sign-up.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      // argon2id via Bun.password, as before: hashes of the former admin_users keep working.
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      // Admin sessions; player sessions set their own expiry (PLAYER_TOKEN_TTL_DAYS).
      expiresIn: config.ADMIN_TOKEN_TTL_HOURS * 3600,
      // Fixed lifetime from the login, like the former JWTs (`expiresAt` in the answer stays true).
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    plugins: [
      admin({ roles, adminRoles: ["admin"], defaultRole: PLAYER_ROLE }),
      bearer({ requireSignature: true }),
      jwt({
        // No JWT header on every session lookup; players fetch one explicitly (GET /auth/token).
        disableSettingJwtHeader: true,
        jwks: {
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          rotationInterval: JWKS_ROTATION_SECONDS,
          gracePeriod: JWKS_GRACE_SECONDS,
        },
        jwt: {
          issuer: config.BETTER_AUTH_URL,
          audience: PLAYER_JWT_AUDIENCE,
          expirationTime: PLAYER_JWT_TTL_SECONDS,
        },
      }),
      soulwickPlayerAuth({
        ...player,
        sessionTtlSeconds: config.PLAYER_TOKEN_TTL_DAYS * 86_400,
      }),
    ],
  });
}

export type SoulwickAuth = ReturnType<typeof createAuth>;
