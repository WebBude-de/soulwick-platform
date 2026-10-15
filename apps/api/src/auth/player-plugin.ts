import { type IdentityProvider, PlayerAppearance } from "@soulwick/contracts";
import type { Player } from "@soulwick/db";
import type {
  BetterAuthPlugin,
  GenericEndpointContext,
  User,
} from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

/**
 * Better Auth plugin `soulwickPlayerAuth` (P-027): sessions for players without e-mail or
 * password. A player signs in with a platform identity (device id, Steam ticket, Google Play
 * server auth code, P-014); the plugin has the identity verified, finds or creates the player
 * (`players` + `player_identities`, unchanged) and starts a Better Auth session for the player's
 * user row (role `player`, `player_id`).
 *
 * Both endpoints are server-only (callable through `auth.api`, never over HTTP). The thin Hono
 * routes under /auth keep paths, bodies and error codes of the game contract; they validate the
 * body with @soulwick/contracts first and then call `auth.api.signInPlayer`. Errors of the
 * callbacks (ApiError: invalid ticket, `banned`, ...) pass through unchanged.
 */

/** Credentials the game sends, after the route validated them with @soulwick/contracts. */
const PlayerCredential = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("device"),
    deviceId: z.string().min(1),
    name: z.string().min(1).optional(),
    appearance: PlayerAppearance.optional(),
  }),
  z.object({
    provider: z.literal("steam"),
    ticket: z.string().min(1),
    name: z.string().min(1).optional(),
    appearance: PlayerAppearance.optional(),
  }),
  z.object({
    provider: z.literal("google_play"),
    serverAuthCode: z.string().min(1),
    name: z.string().min(1).optional(),
    appearance: PlayerAppearance.optional(),
  }),
]);
export type PlayerCredential = z.infer<typeof PlayerCredential>;

export interface VerifiedIdentity {
  /** Character of a new account (P-034); used only when the account is created. */
  appearance?: PlayerAppearance;
  /** Used only when the account is created. */
  name: string;
  provider: IdentityProvider;
  providerUserId: string;
}

export interface SoulwickPlayerAuthOptions {
  /** Finds or creates the player behind a verified identity; throws for banned players. */
  resolvePlayer: (identity: VerifiedIdentity) => Promise<Player>;
  /** Lifetime of a player session in seconds (PLAYER_TOKEN_TTL_DAYS), fixed from the login. */
  sessionTtlSeconds: number;
  /** Checks the credential at the platform (Steam, Google) and returns the identity. */
  verifyIdentity: (credential: PlayerCredential) => Promise<VerifiedIdentity>;
}

/** Role of player users; admin routes accept only `admin` and `moderator`. */
export const PLAYER_ROLE = "player";

/**
 * Better Auth needs a unique e-mail per user. Player users get one on the reserved `.invalid`
 * top-level domain (RFC 2606): it can never receive mail and never clashes with an admin address
 * (admin creation refuses rows with a player id).
 */
export const playerUserEmail = (playerId: string) =>
  `${playerId}@players.soulwick.invalid`;

type PlayerUser = User & { playerId?: string | null };

async function findPlayerUser(
  ctx: GenericEndpointContext,
  playerId: string
): Promise<PlayerUser | null> {
  return await ctx.context.adapter.findOne<PlayerUser>({
    model: "user",
    where: [{ field: "playerId", value: playerId }],
  });
}

/** The user row of a player; created at the first login (two parallel first logins re-read). */
async function playerUser(
  ctx: GenericEndpointContext,
  playerId: string
): Promise<PlayerUser> {
  const existing = await findPlayerUser(ctx, playerId);
  if (existing) {
    return existing;
  }
  try {
    return await ctx.context.internalAdapter.createUser(
      {
        name: PLAYER_ROLE,
        email: playerUserEmail(playerId),
        emailVerified: false,
        role: PLAYER_ROLE,
        playerId,
      },
      { method: "soulwick-player" }
    );
  } catch (err) {
    const raced = await findPlayerUser(ctx, playerId);
    if (raced) {
      return raced;
    }
    throw err;
  }
}

/**
 * Creates the session and sets the session cookie on the endpoint context; the bearer plugin
 * turns that into the `set-auth-token` header the route hands to the game.
 */
async function startPlayerSession(
  ctx: GenericEndpointContext,
  playerId: string,
  ttlSeconds: number
) {
  const user = await playerUser(ctx, playerId);
  // Housekeeping: the game logs in at every start, expired sessions of this player go now.
  await ctx.context.adapter.deleteMany({
    model: "session",
    where: [
      { field: "userId", value: user.id },
      { field: "expiresAt", value: new Date(), operator: "lt" },
    ],
  });
  const session = await ctx.context.internalAdapter.createSession(
    user.id,
    false,
    { expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
    true
  );
  await setSessionCookie(ctx, { session, user });
  return session;
}

export const soulwickPlayerAuth = (options: SoulwickPlayerAuthOptions) =>
  ({
    id: "soulwick-player-auth",
    schema: {
      user: {
        fields: {
          playerId: {
            type: "string",
            required: false,
            input: false,
            unique: true,
          },
        },
      },
    },
    endpoints: {
      /** Platform login: verify identity, find or create the player, start a session. */
      signInPlayer: createAuthEndpoint.serverOnly(
        { method: "POST", body: PlayerCredential },
        async (ctx) => {
          const identity = await options.verifyIdentity(ctx.body);
          const player = await options.resolvePlayer(identity);
          const session = await startPlayerSession(
            ctx,
            player.id,
            options.sessionTtlSeconds
          );
          return ctx.json({ player, expiresAt: session.expiresAt });
        }
      ),
      /** New session for an existing player (POST /me/link hands the remaining account one). */
      createPlayerSession: createAuthEndpoint.serverOnly(
        { method: "POST", body: z.object({ playerId: z.uuid() }) },
        async (ctx) => {
          const session = await startPlayerSession(
            ctx,
            ctx.body.playerId,
            options.sessionTtlSeconds
          );
          return ctx.json({ expiresAt: session.expiresAt });
        }
      ),
    },
  }) satisfies BetterAuthPlugin;
