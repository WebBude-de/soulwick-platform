import type { AuthResponse, AuthTokenResponse } from "@soulwick/contracts";
import { PLAYER_JWT_TTL_SECONDS } from "@soulwick/contracts";
import type { Player } from "@soulwick/db";
import type {
  PlayerCredential,
  SoulwickPlayerAuthOptions,
  VerifiedIdentity,
} from "../auth/player-plugin.ts";
import { ApiError } from "../lib/errors.ts";
import { iso, isoOrNull } from "../lib/validate.ts";
import type { BaseDeps, Deps } from "../types.ts";
import { findActiveBan } from "./bans.ts";
import { verifyGooglePlayCode } from "./google-play.ts";
import { toPlayerSelf } from "./guilds.ts";
import { loginWithIdentity } from "./identities.ts";
import { defaultPlayerName } from "./profile.ts";
import { verifySteamTicket } from "./steam.ts";

/** Name for accounts created through a store login without a name from the game. */
const fallbackName = (providerUserId: string) =>
  `Spieler-${providerUserId.slice(-4)}`;

/**
 * Callbacks of the `soulwickPlayerAuth` plugin (P-027): platform checks (Steam, Google Play) and
 * find-or-create of the player (P-014, unchanged). Configuration checks (501) and the dev key
 * stay in the routes, before the plugin is called.
 */
export function playerLoginCallbacks(
  deps: BaseDeps
): Omit<SoulwickPlayerAuthOptions, "sessionTtlSeconds"> {
  const now = () => deps.now?.() ?? new Date();
  return {
    async verifyIdentity(credential): Promise<VerifiedIdentity> {
      switch (credential.provider) {
        case "device":
          return {
            provider: "device",
            providerUserId: credential.deviceId,
            name: credential.name ?? defaultPlayerName(),
            appearance: credential.appearance,
          };
        case "steam": {
          const steamId = await verifySteamTicket(deps, credential.ticket);
          return {
            provider: "steam",
            providerUserId: steamId,
            name: credential.name ?? fallbackName(steamId),
            appearance: credential.appearance,
          };
        }
        case "google_play": {
          const playerId = await verifyGooglePlayCode(
            deps,
            credential.serverAuthCode
          );
          return {
            provider: "google_play",
            providerUserId: playerId,
            name: credential.name ?? fallbackName(playerId),
            appearance: credential.appearance,
          };
        }
        default:
          throw new ApiError(400, "validation_error", "Unknown provider");
      }
    },

    /** Banned players get 403 `banned` with reason and end (P-107); no session is created. */
    async resolvePlayer(identity): Promise<Player> {
      const at = now();
      const { player } = await loginWithIdentity(deps.db, {
        ...identity,
        now: at,
      });
      const ban = await findActiveBan(deps.db, player.id, at);
      if (ban) {
        throw new ApiError(403, "banned", ban.reason, {
          reason: ban.reason,
          expiresAt: isoOrNull(ban.expiresAt),
        });
      }
      return player;
    },
  };
}

/**
 * The signed session token (`<token>.<signature>`) that the bearer plugin puts into the
 * `set-auth-token` header; clients send it back as `Authorization: Bearer`.
 */
export function sessionTokenFromHeaders(headers: Headers): string {
  const raw = headers.get("set-auth-token");
  if (!raw) {
    throw new Error("Better Auth answered without a session token");
  }
  return decodeURIComponent(raw);
}

/** Request headers for `auth.api.*` that carry only the bearer token (no cookies, no IP). */
export function bearerHeaders(authorization: string | undefined): Headers {
  const headers = new Headers();
  if (authorization) {
    headers.set("authorization", authorization);
  }
  return headers;
}

/** Login through a platform identity; the answer of /auth/dev, /auth/steam, /auth/google-play. */
export async function signInPlayer(
  deps: Deps,
  credential: PlayerCredential
): Promise<AuthResponse> {
  const { headers, response } = await deps.auth.api.signInPlayer({
    body: credential,
    returnHeaders: true,
  });
  return {
    token: sessionTokenFromHeaders(headers),
    expiresAt: iso(response.expiresAt),
    player: await toPlayerSelf(deps.db, response.player),
  };
}

/** A new session for an existing player (POST /me/link: the remaining account). */
export async function issuePlayerSession(
  deps: Deps,
  player: Player
): Promise<AuthResponse> {
  const { headers, response } = await deps.auth.api.createPlayerSession({
    body: { playerId: player.id },
    returnHeaders: true,
  });
  return {
    token: sessionTokenFromHeaders(headers),
    expiresAt: iso(response.expiresAt),
    player: await toPlayerSelf(deps.db, player),
  };
}

/**
 * The session behind a bearer token (admins and players), or null. Read from the database on
 * every call (no cookie cache), so ended sessions, deleted players and disabled admins lose
 * access at once.
 */
export async function sessionFromAuthorization(
  deps: Deps,
  authorization: string | undefined
) {
  if (!authorization) {
    return null;
  }
  return await deps.auth.api.getSession({
    headers: bearerHeaders(authorization),
  });
}

/**
 * GET /auth/token: short-lived JWT (EdDSA, jwt plugin) for `hello.token` at the relay. Claims
 * `sub` = player id, `name`, `iat`, `exp`, `iss` = BETTER_AUTH_URL, `aud` = PLAYER_JWT_AUDIENCE.
 * Uses the wall clock like Better Auth and the relay.
 */
export async function issuePlayerJwt(
  deps: Deps,
  player: Player
): Promise<AuthTokenResponse> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + PLAYER_JWT_TTL_SECONDS;
  const { token } = await deps.auth.api.signJWT({
    body: { payload: { sub: player.id, name: player.name, iat, exp } },
  });
  return { token, expiresAt: iso(new Date(exp * 1000)) };
}
