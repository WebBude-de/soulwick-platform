import { z } from "zod";
import {
  GuildRole,
  IsoDateTime,
  PlayerAppearance,
  PlayerLevel,
  PlayerName,
  Uuid,
} from "./common.ts";
import { ROOM_CODE_ALPHABET } from "./lobby.ts";
import { AuthResponse } from "./player.ts";

/**
 * Platform logins, linked identities and account deletion (KONZEPT_ONLINE.md §3, D-121, D-122,
 * P-014). Every login route answers with the same `AuthResponse` as `/auth/dev` and `/auth/steam`.
 */

/** Where an identity comes from. One Soulwick account can have several identities (D-121). */
export const IdentityProvider = z.enum([
  "steam",
  "device",
  "google_play",
  "game_center",
]);
export type IdentityProvider = z.infer<typeof IdentityProvider>;

// --- login --------------------------------------------------------------------------------------

/**
 * POST /auth/google-play. The game calls Play Games Services v2 `requestServerSideAccess` with the
 * web OAuth client id of the server and sends the resulting one-time server auth code. The server
 * exchanges it at Google and asks Google for the player id; a player id from the device is never
 * accepted. Errors: 501 `provider_not_configured`, 401 `invalid_google_play_code`,
 * 502 `google_play_unavailable`, 403 `banned`.
 */
export const GooglePlayAuthRequest = z.object({
  serverAuthCode: z.string().trim().min(10).max(2048),
  /** Display name used when the account is created. */
  name: PlayerName.optional(),
  /** Character used when the account is created (P-034). */
  appearance: PlayerAppearance.optional(),
});
export type GooglePlayAuthRequest = z.infer<typeof GooglePlayAuthRequest>;

/**
 * POST /auth/game-center (planned with iOS; the route answers 501 `not_implemented` until then).
 * Values from GKLocalPlayer `fetchItems(forIdentityVerificationSignature:)`; the server checks
 * that `publicKeyUrl` is an Apple domain, verifies the signature over
 * playerId + bundleId + timestamp (uint64 big endian) + salt and the age of `timestamp`.
 */
export const GameCenterAuthRequest = z.object({
  publicKeyUrl: z.url(),
  /** Base64. */
  signature: z.string().min(1).max(4096),
  /** Base64. */
  salt: z.string().min(1).max(1024),
  /** Milliseconds since the epoch, as returned by Game Center. */
  timestamp: z.number().int().min(0),
  /** `teamPlayerID`. */
  playerId: z.string().trim().min(1).max(128),
  bundleId: z.string().trim().min(1).max(255),
  name: PlayerName.optional(),
});
export type GameCenterAuthRequest = z.infer<typeof GameCenterAuthRequest>;

// --- identities ---------------------------------------------------------------------------------

/** One identity of the own account. The provider user id is never sent in full. */
export const IdentitySummary = z.object({
  /** Row id of the identity (not the provider user id). */
  id: Uuid,
  provider: IdentityProvider,
  /** Last characters of the provider user id for recognition, e.g. "***0001". */
  maskedId: z.string(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
});
export type IdentitySummary = z.infer<typeof IdentitySummary>;

/** GET /me/identities, also the answer of DELETE /me/identities/:provider. Oldest first. */
export const IdentityList = z.object({ items: z.array(IdentitySummary) });
export type IdentityList = z.infer<typeof IdentityList>;

// --- link codes (D-121) -------------------------------------------------------------------------

export const LINK_CODE_LENGTH = 6;
/** TESTWERT: lifetime of a link code. */
export const LINK_CODE_TTL_SECONDS = 600;
/** Same alphabet as the relay room codes (no 0/O, 1/I/L). */
export const LINK_CODE_ALPHABET = ROOM_CODE_ALPHABET;

/** Accepts lower case and surrounding spaces from user input; normalised to upper case. */
export const LinkCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .length(LINK_CODE_LENGTH)
      .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/, "invalid link code")
  );
export type LinkCode = z.infer<typeof LinkCode>;

/**
 * POST /me/link-code (no body). A player has at most one active code; a new code replaces the
 * previous one.
 */
export const LinkCodeResponse = z.object({
  code: z.string(),
  expiresAt: IsoDateTime,
});
export type LinkCodeResponse = z.infer<typeof LinkCodeResponse>;

/**
 * POST /me/link, sent by the OTHER device while logged in with its own account (D-121, D-122).
 * - One account empty (no guild, no runs): it is absorbed silently into the other one.
 * - Both have progress: 409 `account_has_progress` (body `AccountHasProgressResponse`) until the
 *   game asks the player and repeats the call with `confirmMerge: true`; then the OLDER account
 *   remains and receives the identities, runs and the guild memberships of the other (D-147:
 *   memberships move while the remaining account stays within MAX_GUILDS_PER_PLAYER; in a guild
 *   both are in, the higher role stays; the rest are left with the founder hand-over of P-102).
 * - Either account banned: 409 `merge_blocked_banned`. Own code: 409 `already_linked`.
 * - Unknown code 404 `link_code_not_found`, expired 410 `link_code_expired`.
 */
export const LinkAccountRequest = z.object({
  code: LinkCode,
  confirmMerge: z.boolean().optional().default(false),
});
export type LinkAccountRequest = z.input<typeof LinkAccountRequest>;

/** What the game shows before a merge. */
export const AccountSummary = z.object({
  id: Uuid,
  name: z.string(),
  createdAt: IsoDateTime,
  /** Oldest guild membership (same as `guilds[0]`), kept for older game builds. */
  guild: z
    .object({ name: z.string(), tag: z.string(), role: GuildRole })
    .nullable(),
  /** All active guilds (D-147). Optional for older API builds. */
  guilds: z
    .array(z.object({ name: z.string(), tag: z.string(), role: GuildRole }))
    .optional(),
  /** Run participations. */
  runCount: z.number().int().min(0),
  providers: z.array(IdentityProvider),
  /**
   * Account XP and level (D-188). XP > 0 counts as progress (no silent merge); a merge adds the
   * XP of both accounts, each run id once. Optional for older API builds.
   */
  xp: z.number().int().min(0).optional(),
  level: PlayerLevel.optional(),
});
export type AccountSummary = z.infer<typeof AccountSummary>;

/** 409 body of POST /me/link without `confirmMerge` when both accounts have progress. */
export const AccountHasProgressResponse = z.object({
  error: z.literal("account_has_progress"),
  message: z.string().optional(),
  /** Stays (older `createdAt`); name and guild memberships of this account win. */
  remaining: AccountSummary,
  /** Gets deleted after its identities, runs and (within the guild limit) memberships moved over. */
  removed: AccountSummary,
});
export type AccountHasProgressResponse = z.infer<
  typeof AccountHasProgressResponse
>;

/**
 * 200 of POST /me/link: a fresh token for the remaining account (it may be the code owner's or
 * the caller's). Tokens of the removed account stop working; its devices log in again through
 * their identity and land on the remaining account.
 */
export const LinkAccountResponse = AuthResponse.extend({
  /** true = both accounts had progress and were merged (after `confirmMerge`). */
  merged: z.boolean(),
  removedPlayerId: Uuid,
  identities: z.array(IdentitySummary),
});
export type LinkAccountResponse = z.infer<typeof LinkAccountResponse>;

// --- account deletion (Google Play requirement, KONZEPT_ONLINE.md §3.7, P-026) -----------------

/**
 * Fully automatic deletion (P-026, replaces the manual requests of P-022): the game creates a
 * one-time deletion code, the website checks player name + code and deletes the account after a
 * confirmation step. Every deletion (website, in game, admin) leaves a row in the deletion log
 * without personal data.
 */
export const DELETION_CODE_LENGTH = 8;
/** TESTWERT: lifetime of a deletion code. */
export const DELETION_CODE_TTL_SECONDS = 900;
/** TESTWERT: wrong codes typed for a player name before that player's code stops working. */
export const DELETION_CODE_MAX_ATTEMPTS = 5;
/** TESTWERT: lifetime of the confirmation token returned by POST /account-deletion/verify. */
export const DELETION_TOKEN_TTL_SECONDS = 600;

/**
 * Proof of account ownership for the website; same alphabet as link codes (no 0/O, 1/I/L).
 * Spaces and dashes are ignored, lower case accepted.
 */
export const DeletionCode = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .length(DELETION_CODE_LENGTH)
      .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/, "invalid deletion code")
  );
export type DeletionCode = z.infer<typeof DeletionCode>;

/**
 * 201 of POST /me/deletion-code (logged-in player, no body). The code is valid for
 * DELETION_CODE_TTL_SECONDS and once; a new code replaces the previous one. Only an HMAC is
 * stored, so the plain code is shown exactly once. (GET /me/deletion-code with a fixed code was
 * removed with P-026.)
 */
export const DeletionCodeResponse = z.object({
  code: z.string(),
  expiresAt: IsoDateTime,
});
export type DeletionCodeResponse = z.infer<typeof DeletionCodeResponse>;

/**
 * POST /account-deletion/verify (public, no login; rate limit per IP `DELETION_REQUESTS_PER_HOUR`,
 * plus DELETION_CODE_MAX_ATTEMPTS wrong codes per player name burn that player's code).
 * Errors: 400 `invalid_deletion_code` (name unknown, code wrong, expired, used, replaced or burned:
 * one answer for all), 400 `validation_error`, 429 `rate_limited`.
 */
export const AccountDeletionVerifyRequest = z.object({
  /** Case-insensitive. */
  playerName: z.string().trim().min(2).max(64),
  code: DeletionCode,
});
export type AccountDeletionVerifyRequest = z.input<
  typeof AccountDeletionVerifyRequest
>;

/** What the website shows before the final confirmation; nothing sensitive. */
export const AccountDeletionPreview = z.object({
  playerName: z.string(),
  /** Oldest current guild (same as `guilds[0]`), null if none. */
  guild: z.object({ name: z.string(), tag: z.string() }).nullable(),
  /**
   * All current guilds (D-147), oldest first. `role` shows where the founder role passes on (P-102)
   * or the guild is disbanded; optional for older API builds, like the list itself.
   */
  guilds: z
    .array(
      z.object({
        name: z.string(),
        tag: z.string(),
        role: GuildRole.optional(),
      })
    )
    .optional(),
  /** Runs the player took part in (they stay anonymised in the guild boards). */
  runCount: z.number().int().min(0),
  /** Bug reports the player sent; they are deleted with the account (P-033). Optional for older API builds. */
  bugReportCount: z.number().int().min(0).optional(),
});
export type AccountDeletionPreview = z.infer<typeof AccountDeletionPreview>;

/** 200 of POST /account-deletion/verify. */
export const AccountDeletionVerifyResponse = z.object({
  /** Signed, bound to the account and this code; valid for DELETION_TOKEN_TTL_SECONDS. */
  token: z.string(),
  expiresAt: IsoDateTime,
  account: AccountDeletionPreview,
});
export type AccountDeletionVerifyResponse = z.infer<
  typeof AccountDeletionVerifyResponse
>;

/**
 * POST /account-deletion/confirm (public). Deletes the account right away, exactly like DELETE /me
 * (identities, guild membership with founder hand-over P-102, runs anonymised), also when the
 * player is banned (privacy; logged), and uses up the code. Errors: 400 `deletion_token_invalid`
 * (malformed, expired, already used, or the code was replaced), 400 `validation_error`.
 */
export const AccountDeletionConfirmRequest = z.object({
  token: z.string().trim().min(1).max(2048),
});
export type AccountDeletionConfirmRequest = z.infer<
  typeof AccountDeletionConfirmRequest
>;

/** 200 of POST /account-deletion/confirm. */
export const AccountDeletionConfirmResponse = z.object({
  deleted: z.literal(true),
  deletedAt: IsoDateTime,
});
export type AccountDeletionConfirmResponse = z.infer<
  typeof AccountDeletionConfirmResponse
>;

/** How an account was deleted (deletion log, P-026). */
export const AccountDeletionChannel = z.enum(["web_code", "in_game", "admin"]);
export type AccountDeletionChannel = z.infer<typeof AccountDeletionChannel>;
