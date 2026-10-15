import type { AdminRole } from "@soulwick/contracts";
import type { Db, Player } from "@soulwick/db";
import type { SoulwickAuth } from "./auth/auth.ts";
import type { Config } from "./config.ts";

/** What the process (index.ts) or a test hands to `createApp`. */
export interface BaseDeps {
  config: Config;
  /** Prisma client from @soulwick/db (`createPrisma`); tests pass one per throwaway database. */
  db: Db;
  /** Injectable for tests (Steam Web API, Google, eRecht24, relay). */
  fetch?: typeof fetch;
  /** Injectable clock for tests. Better Auth checks session expiry against the wall clock. */
  now?: () => Date;
}

/** Everything routes and middleware get: the base plus the Better Auth instance (P-027). */
export interface Deps extends BaseDeps {
  auth: SoulwickAuth;
}

/** The signed-in admin or moderator (Better Auth user with an admin role). */
export interface AdminAccount {
  createdAt: Date;
  email: string;
  id: string;
  role: AdminRole;
}

export interface AppEnv {
  Variables: {
    player: Player;
    /** Set by optionalPlayer when a valid player token was sent. */
    maybePlayer: Player | null;
    admin: AdminAccount;
  };
}
