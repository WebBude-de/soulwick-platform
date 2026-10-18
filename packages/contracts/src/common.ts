import { z } from "zod";

/** Version of the HTTP contract. Bump on breaking changes; the API reports it in `GET /health`. */
export const API_VERSION = "1.1.0";

export const RunMode = z.enum(["solo", "quick", "guild"]);
export type RunMode = z.infer<typeof RunMode>;

export const GuildRole = z.enum(["founder", "officer", "member"]);
export type GuildRole = z.infer<typeof GuildRole>;

export const AdminRole = z.enum(["admin", "moderator"]);
export type AdminRole = z.infer<typeof AdminRole>;

/** solo = solo runs per player, group = quick/guild runs per player, guild = guild runs per guild. */
export const LeaderboardKind = z.enum(["solo", "group", "guild"]);
export type LeaderboardKind = z.infer<typeof LeaderboardKind>;

export const LeaderboardPeriod = z.enum(["all", "season"]);
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriod>;

/** Season id, one per calendar month (UTC), e.g. "2026-10". */
export const SeasonId = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM");
export type SeasonId = z.infer<typeof SeasonId>;

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });

export const PlayerName = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N} _.-]+$/u, "letters, digits, space, _ . - only");

// --- account profile (P-034, D-152) -------------------------------------------------------------

/**
 * The account's one character (D-152): save games are only "worlds" and no longer name the
 * account. Values may be added later (additive); a game build that does not know a value shows
 * its default character.
 */
export const PlayerCharacter = z.enum(["wick", "ember", "moss", "frost"]);
export type PlayerCharacter = z.infer<typeof PlayerCharacter>;

/** TESTWERT: highest palette index per colour slot (8 choices, 0..7). */
export const PLAYER_APPEARANCE_COLOR_MAX = 7;

const PaletteIndex = z.number().int().min(0).max(PLAYER_APPEARANCE_COLOR_MAX);

/**
 * Look of the account's character: one of the figures plus palette indexes (all freely
 * selectable). null/missing on an account = the game uses its default character.
 */
export const PlayerAppearance = z.object({
  character: PlayerCharacter,
  colors: z.object({
    hair: PaletteIndex,
    outfit: PaletteIndex,
    skin: PaletteIndex,
    accent: PaletteIndex.optional(),
  }),
});
export type PlayerAppearance = z.infer<typeof PlayerAppearance>;

/**
 * Account level of a player (D-188): `levelForXp(xp)` from xp.ts, starting at 1. Cosmetic only;
 * shown in the lobby, guild lists and leaderboards.
 */
export const PlayerLevel = z.number().int().min(1);

export const GuildName = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[\p{L}\p{N} _.'-]+$/u, "letters, digits, space, _ . ' - only");

/** 2–5 letters/digits, stored upper case. */
export const GuildTag = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{2,5}$/, "2-5 letters or digits")
  .transform((s) => s.toUpperCase());

export const InviteCode = z
  .string()
  .trim()
  .min(6)
  .max(16)
  .transform((s) => s.toUpperCase());

/** Generic error body. `error` is a stable machine-readable code. */
export const ErrorResponse = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Returned with HTTP 403 on every authenticated player route while a ban is active. */
export const BannedResponse = z.object({
  error: z.literal("banned"),
  reason: z.string(),
  /** null = permanent */
  expiresAt: IsoDateTime.nullable(),
});
export type BannedResponse = z.infer<typeof BannedResponse>;

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  apiVersion: z.string(),
  db: z.enum(["ok", "error"]),
  time: IsoDateTime,
  /**
   * Oldest game version allowed to use the online features; older games lock them and ask for an
   * update (KONZEPT_ONLINE.md §3.8). null = no lower bound. Optional: older APIs do not send it.
   */
  minGameVersion: z.string().nullable().optional(),
  /** Network protocol version of this environment (same value as the relay, P16). Optional. */
  protocolVersion: z.number().int().min(0).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/**
 * GET /public/config: what a game build needs to know about its environment (P16, P-018).
 * Cached for 60 s.
 */
export const PublicConfig = z.object({
  apiVersion: z.string(),
  /** See HealthResponse.minGameVersion. */
  minGameVersion: z.string().nullable(),
  /** The relay only admits clients with exactly this `hello.protocolVersion`. */
  protocolVersion: z.number().int().min(0),
  /** Full WebSocket URL of the relay including the path, e.g. "wss://play.playsoulwick.com/v1"; null = no relay in this environment. */
  relayUrl: z.string().nullable(),
  /**
   * Support address for players without access to the game any more (account deletion, P-026);
   * null = do not show one. Optional for older API builds.
   */
  supportEmail: z.string().nullable().optional(),
  /**
   * true = guest login per device (`POST /auth/device`, P-028) is open in this environment.
   * Optional for older API builds (missing = treat as false).
   */
  guestAuth: z.boolean().optional(),
});
export type PublicConfig = z.infer<typeof PublicConfig>;
