import { z } from "zod";
import {
  GuildRole,
  IsoDateTime,
  PlayerAppearance,
  PlayerName,
  Uuid,
} from "./common.ts";
import { AccountLevel } from "./xp.ts";

/**
 * POST /auth/dev. `name` and `appearance` are only used when the account is created (the game sends
 * the account profile, D-152); optional since P-034: a new account without a name is called
 * "Spieler-1234" (random digits) until the player sets a name with `PATCH /me`.
 */
export const DevAuthRequest = z.object({
  name: PlayerName.optional(),
  /** Random id generated once per installation by the game. */
  deviceId: z.string().trim().min(16).max(128),
  appearance: PlayerAppearance.optional(),
});
export type DevAuthRequest = z.infer<typeof DevAuthRequest>;

/**
 * Device id of a guest account: a random id the game creates once per installation (UUID v4,
 * 36 characters). It is the only secret of the account, so the game never shows it.
 */
export const GuestDeviceId = z
  .string()
  .trim()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9-]+$/, "letters, digits and - only");
export type GuestDeviceId = z.infer<typeof GuestDeviceId>;

/**
 * POST /auth/device: guest login per device (P-028), no key needed. Same `device` identity as
 * `/auth/dev`, so a device that used the dev login lands on the same account. `name` and
 * `appearance` are only used when the account is created and are optional (P-034, like
 * `DevAuthRequest`); existing accounts keep their profile. Later the guest account is linked to Steam / Google Play via
 * `POST /me/link-code` + `POST /me/link`. Answer: `AuthResponse`. Errors: 400 `validation_error`,
 * 403 `guest_auth_disabled`, 403 `banned`, 429 `rate_limited` (logins per IP and minute, or new
 * guest accounts per IP and hour).
 */
export const DeviceAuthRequest = z.object({
  name: PlayerName.optional(),
  deviceId: GuestDeviceId,
  appearance: PlayerAppearance.optional(),
});
export type DeviceAuthRequest = z.infer<typeof DeviceAuthRequest>;

export const SteamAuthRequest = z.object({
  /** Hex-encoded ticket from ISteamUser::GetAuthTicketForWebApi. */
  ticket: z
    .string()
    .regex(/^[0-9a-fA-F]+$/)
    .min(16)
    .max(8192),
  /** Display name used when the account is created (e.g. Steam persona name). */
  name: PlayerName.optional(),
  /** Character used when the account is created (P-034). */
  appearance: PlayerAppearance.optional(),
});
export type SteamAuthRequest = z.infer<typeof SteamAuthRequest>;

export const PlayerGuildRef = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string(),
  role: GuildRole,
});
export type PlayerGuildRef = z.infer<typeof PlayerGuildRef>;

export const PlayerSelf = z.object({
  id: Uuid,
  name: z.string(),
  steamId: z.string().nullable(),
  createdAt: IsoDateTime,
  /**
   * @deprecated Since D-147 a player can be in several guilds: this is the oldest membership
   * (same as `guilds[0]`), kept for older game builds. Use `guilds`.
   */
  guild: PlayerGuildRef.nullable(),
  /** All active guilds of the player, oldest membership first (D-147, at most MAX_GUILDS_PER_PLAYER). */
  guilds: z.array(PlayerGuildRef),
  /**
   * The account's character (P-034, D-152); null = not chosen yet, the game shows its default.
   * Optional for older API builds.
   */
  appearance: PlayerAppearance.nullable().optional(),
  /**
   * Account XP and level (D-188, KF3): `xp`, `level`, `levelStartXp`, `nextLevelXp`,
   * `xpToNextLevel` as in `AccountLevel`. Optional for older API builds (missing = the game shows
   * its local level only).
   */
  ...AccountLevel.partial().shape,
});
export type PlayerSelf = z.infer<typeof PlayerSelf>;

/** TESTWERT: name changes per player through `PATCH /me` in NAME_CHANGE_WINDOW_HOURS (admins: no limit). */
export const MAX_NAME_CHANGES = 3;
/** TESTWERT: sliding window of the name change limit. */
export const NAME_CHANGE_WINDOW_HOURS = 24;

/**
 * PATCH /me (player session) -> 200 `PlayerSelf`: changes the account profile (D-152). At least
 * one field. `name` is a display name (not unique); setting the current name again is a no-op and
 * does not count. `appearance` replaces the whole look; `null` resets it to the default character.
 * Errors: 400 `validation_error`, 401, 403 `banned`, 429 `name_change_limited` (more than
 * MAX_NAME_CHANGES name changes in NAME_CHANGE_WINDOW_HOURS; body `retryAfter` and header
 * `Retry-After` in seconds; the appearance part of such a request is not applied either).
 */
export const UpdateProfileRequest = z
  .object({
    name: PlayerName.optional(),
    appearance: PlayerAppearance.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.appearance !== undefined, {
    message: "name or appearance required",
  });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

/**
 * Answer of every player login (`POST /auth/dev`, `/auth/device`, `/auth/steam`,
 * `/auth/google-play`) and of `POST /me/link` (P-027). `token` is a Better Auth session token (opaque, signed
 * `<token>.<signature>`); send it on every player route as `Authorization: Bearer <token>`. It
 * lives PLAYER_TOKEN_TTL_DAYS (30 days) from the login, without sliding refresh; afterwards, or
 * after a 401 `unauthorized`, the game logs in again. The relay does not take it: see
 * `GET /auth/token`.
 */
export const AuthResponse = z.object({
  token: z.string(),
  expiresAt: IsoDateTime,
  player: PlayerSelf,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

// --- relay token (P-027) -------------------------------------------------------------------------

/** TESTWERT: lifetime of the player JWT from `GET /auth/token`. */
export const PLAYER_JWT_TTL_SECONDS = 900;
/** `aud` claim of the player JWT; the relay accepts nothing else. */
export const PLAYER_JWT_AUDIENCE = "soulwick-relay";
/** Public keys of the player JWTs (JSON Web Key Set, EdDSA/Ed25519), path on the API. */
export const PLAYER_JWKS_PATH = "/auth/jwks";

/**
 * GET /auth/token with `Authorization: Bearer <session token>` (players only; admin sessions get
 * 401 `unauthorized`, banned players 403 `banned`). Returns a short-lived JWT (EdDSA, signed by the
 * Better Auth jwt plugin) for `hello.token` at the relay. Fetch a new one before every connection
 * to the relay; a running connection is not affected when it expires.
 */
export const AuthTokenResponse = z.object({
  token: z.string(),
  /** `exp` of the JWT; PLAYER_JWT_TTL_SECONDS after issue. */
  expiresAt: IsoDateTime,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponse>;

/** Claims of the player JWT. Keys rotate; verify against PLAYER_JWKS_PATH (by `kid`). */
export const PlayerJwtClaims = z.object({
  /** Player id (`players.id`), the same as `PlayerSelf.id`. */
  sub: Uuid,
  /** Player name at the time of issue. */
  name: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  /** BETTER_AUTH_URL of the API that issued it. */
  iss: z.string(),
  aud: z.literal(PLAYER_JWT_AUDIENCE),
});
export type PlayerJwtClaims = z.infer<typeof PlayerJwtClaims>;
