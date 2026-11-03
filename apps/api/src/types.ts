import type { AdminRole } from "@soulwick/contracts";
import type { Db, Player } from "@soulwick/db";
import type { SoulwickAuth } from "./auth/auth.ts";
import type { Config } from "./config.ts";
import type { Mailer } from "./lib/mail.ts";
import type { AppleKeys } from "./services/apple.ts";
import type { GameCenterVerifier } from "./services/game-center.ts";

/** What the process (index.ts) or a test hands to `createApp`. */
export interface BaseDeps {
  config: Config;
  /** Prisma client from @soulwick/db (`createPrisma`); tests pass one per throwaway database. */
  db: Db;
  /** Injectable for tests (Steam Web API, Google, eRecht24, relay). */
  fetch?: typeof fetch;
  /** Tests only: CA certificates (PEM) trusted for Game Center instead of DigiCert's chain. */
  gameCenterCas?: readonly string[];
  /** Injectable clock for tests. Better Auth checks session expiry against the wall clock. */
  now?: () => Date;
}

/** Everything routes and middleware get: the base plus the Better Auth instance (P-027). */
export interface Deps extends BaseDeps {
  /** Apple's signing keys, cached per app (Sign in with Apple, KF5). */
  appleKeys: AppleKeys;
  auth: SoulwickAuth;
  /** Game Center certificates, cached per app (KF5). */
  gameCenter: GameCenterVerifier;
  /** Mail adapter of the magic links (MAIL_ADAPTER, KF5). */
  mailer: Mailer;
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
    /** Id of the admin session of this request (set by requireAdmin). */
    adminSessionId: string;
  };
}
