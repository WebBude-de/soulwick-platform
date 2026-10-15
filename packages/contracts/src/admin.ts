import { z } from "zod";
import {
  AdminRole,
  GuildName,
  GuildRole,
  GuildTag,
  IsoDateTime,
  PaginationQuery,
  PlayerName,
  RunMode,
  Uuid,
} from "./common.ts";
import { GuildMember, GuildProgress } from "./guild.ts";
import { AccountDeletionChannel } from "./identity.ts";
import {
  RelayCloseRoomRequest,
  RelayCloseRoomResponse,
  RelayKickRequest,
  RelayKickResponse,
  RelayRoomList,
} from "./lobby.ts";

/** Wraps a page of results with the total count of matching rows. */
export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().min(0) });

// --- auth ---------------------------------------------------------------------------------------

export const AdminEmail = z.string().trim().toLowerCase().pipe(z.email());

/** Minimum 12 characters for admin passwords. */
export const AdminPassword = z.string().min(12).max(256);

/**
 * Admin sessions (P-027, Better Auth with e-mail/password and the admin plugin):
 * - `POST /admin/auth/login` `AdminLoginRequest` -> 200 `AdminLoginResponse`. 10 attempts per
 *   minute and IP. Wrong e-mail or password and disabled accounts: 401 `invalid_credentials`;
 *   429 `rate_limited`; 400 `validation_error`.
 * - Every other `/admin/*` route: `Authorization: Bearer <token>`. Missing, expired, revoked or
 *   player tokens and disabled accounts: 401 `unauthorized`; too low a role: 403 `forbidden`.
 *   The role is read from the database on every call.
 * - `GET /admin/me` -> `AdminSelf`: checks the session (use it to validate the panel cookie).
 * - `POST /admin/auth/logout` (Bearer, no body) -> 204: ends this session on the server.
 * The admin panel keeps the token in its own httpOnly cookie and calls the API server-side only.
 */
export const AdminLoginRequest = z.object({
  email: AdminEmail,
  password: z.string().min(1).max(256),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequest>;

export const AdminSelf = z.object({
  id: Uuid,
  email: z.string(),
  role: AdminRole,
  createdAt: IsoDateTime,
});
export type AdminSelf = z.infer<typeof AdminSelf>;

export const AdminLoginResponse = z.object({
  /**
   * Better Auth session token (opaque, signed `<token>.<signature>`); send as
   * `Authorization: Bearer`. Valid ADMIN_TOKEN_TTL_HOURS (8 h) from the login, no sliding refresh.
   */
  token: z.string(),
  /** End of the session; the panel cookie should not outlive it. */
  expiresAt: IsoDateTime,
  admin: AdminSelf,
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponse>;

/**
 * Own account of the signed-in admin or moderator (both roles, only for themselves):
 * - `POST /admin/me/password` `AdminChangePasswordRequest` -> 200 `AdminChangePasswordResponse`.
 *   Ends all other sessions of this account; the calling session stays valid (same token, same
 *   `expiresAt`). Audit `admin.password_change` (never the password).
 * - `POST /admin/me/email` `AdminChangeEmailRequest` -> 200 `AdminSelf` with the new address,
 *   normalised like `AdminEmail` (trimmed, lower case). No confirmation mail (no mail delivery
 *   yet); sessions stay. Audit `admin.email_change` with `from` / `to`.
 * Errors: 400 `invalid_current_password` (wrong current password, nothing else is told),
 * 400 `password_unchanged` / `email_unchanged`, 409 `email_taken` (checked only after the
 * password), 400 `validation_error` (e.g. new password shorter than 12 characters), 429
 * `rate_limited`: 10 requests per minute and IP, and 5 wrong current passwords per 15 minutes and
 * account (both TESTWERT, also counted across both routes).
 */
export const AdminChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: AdminPassword,
});
export type AdminChangePasswordRequest = z.infer<
  typeof AdminChangePasswordRequest
>;

export const AdminChangePasswordResponse = z.object({
  /** Number of other sessions of this account that were ended. */
  revokedSessions: z.number().int().min(0),
});
export type AdminChangePasswordResponse = z.infer<
  typeof AdminChangePasswordResponse
>;

export const AdminChangeEmailRequest = z.object({
  email: AdminEmail,
  currentPassword: z.string().min(1).max(256),
});
export type AdminChangeEmailRequest = z.infer<typeof AdminChangeEmailRequest>;

export const RunModeCounts = z.object({
  solo: z.number().int().min(0),
  quick: z.number().int().min(0),
  guild: z.number().int().min(0),
});
export type RunModeCounts = z.infer<typeof RunModeCounts>;

/**
 * GET /admin/stats (moderator and admin). Fields after `openDeletionRequests` came with "Admin-API
 * v2" (P-023) and are optional for older API builds. "7d" = the last 7 × 24 hours, "24h" = the
 * last 24 hours, measured from the request time.
 */
export const AdminStats = z.object({
  players: z.number().int(),
  activeBans: z.number().int(),
  /** Active (not disbanded) guilds. */
  guilds: z.number().int(),
  flaggedRuns: z.number().int(),
  /**
   * @deprecated Manual deletion requests were removed with P-026; the API always sends 0. Use
   * `deletions7d`.
   */
  openDeletionRequests: z.number().int().optional(),
  /** Accounts created in the last 7 days. */
  newPlayers7d: z.number().int().optional(),
  /** Accounts with `lastSeenAt` (login or any player call) in the last 7 days. */
  activePlayers7d: z.number().int().optional(),
  runs24h: z.number().int().optional(),
  runs7d: z.number().int().optional(),
  runsTotal: z.number().int().optional(),
  /** All runs ever, per mode. */
  runsByMode: RunModeCounts.optional(),
  /** Active guilds with at least one member seen in the last 7 days. */
  activeGuilds7d: z.number().int().optional(),
  /** Deleted accounts (all channels) in the last 7 days, from the deletion log (P-026). */
  deletions7d: z.number().int().optional(),
});
export type AdminStats = z.infer<typeof AdminStats>;

/** Most days GET /admin/stats/daily returns. */
export const ADMIN_STATS_MAX_DAYS = 90;

/** GET /admin/stats/daily?days=30 (moderator and admin). */
export const AdminDailyStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(ADMIN_STATS_MAX_DAYS).default(30),
});
export type AdminDailyStatsQuery = z.infer<typeof AdminDailyStatsQuery>;

/** Calendar day in UTC, e.g. "2026-10-15". */
export const UtcDate = z.iso.date();

export const AdminDailyStatsDay = z.object({
  date: UtcDate,
  /** Accounts created on this day. */
  newPlayers: z.number().int().min(0),
  /** Runs reported on this day (flagged ones included). */
  runs: z.number().int().min(0),
  /**
   * Distinct players who took part in a run reported on this day. There is no login history
   * (only the latest `lastSeenAt`), so run participation is the daily activity measure (P-023).
   */
  activePlayers: z.number().int().min(0),
});
export type AdminDailyStatsDay = z.infer<typeof AdminDailyStatsDay>;

/** Run count of runs whose `roomReached` lies in [min, max]; `max` null = open end. */
export const RoomReachedBucket = z.object({
  min: z.number().int().min(0),
  max: z.number().int().nullable(),
  runs: z.number().int().min(0),
});
export type RoomReachedBucket = z.infer<typeof RoomReachedBucket>;

/**
 * Only aggregated numbers, no player lists. Window: `from` 00:00 UTC up to the request time;
 * `series` has one entry per day (oldest first, days without data as zeros). Distribution and
 * averages leave flagged runs out; null without unflagged runs. The game does not report biomes
 * yet, so there are no biome figures.
 */
export const AdminDailyStats = z.object({
  days: z.number().int(),
  from: UtcDate,
  to: UtcDate,
  generatedAt: IsoDateTime,
  series: z.array(AdminDailyStatsDay),
  totals: z.object({
    newPlayers: z.number().int().min(0),
    runs: z.number().int().min(0),
    flaggedRuns: z.number().int().min(0),
    /** Distinct run participants in the whole window. */
    activePlayers: z.number().int().min(0),
    runsByMode: RunModeCounts,
  }),
  /** TESTWERT bucket edges: 0-5, 6-10, 11-15, 16-20, 21-30, 31-40, 41-50, 51+. */
  roomReached: z.array(RoomReachedBucket),
  averageRoomReached: z.number().nullable(),
  averageDurationSeconds: z.number().nullable(),
  medianDurationSeconds: z.number().nullable(),
});
export type AdminDailyStats = z.infer<typeof AdminDailyStats>;

// --- players ------------------------------------------------------------------------------------

export const AdminSearchQuery = PaginationQuery.extend({
  /** Name (substring), player/guild id or Steam id. */
  q: z.string().trim().max(100).optional(),
});
export type AdminSearchQuery = z.infer<typeof AdminSearchQuery>;

export const AdminPlayerListItem = z.object({
  id: Uuid,
  name: z.string(),
  steamId: z.string().nullable(),
  hasDeviceId: z.boolean(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  banned: z.boolean(),
  guildTag: z.string().nullable(),
});
export type AdminPlayerListItem = z.infer<typeof AdminPlayerListItem>;

export const AdminPlayerList = page(AdminPlayerListItem);
export type AdminPlayerList = z.infer<typeof AdminPlayerList>;

export const AdminBan = z.object({
  id: Uuid,
  reason: z.string(),
  createdAt: IsoDateTime,
  /** null = permanent */
  expiresAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  createdBy: z.string().nullable(),
  revokedBy: z.string().nullable(),
  active: z.boolean(),
});
export type AdminBan = z.infer<typeof AdminBan>;

export const AdminRunParticipant = z.object({ id: Uuid, name: z.string() });

export const AdminRun = z.object({
  id: Uuid,
  mode: RunMode,
  guildId: Uuid.nullable(),
  guildTag: z.string().nullable(),
  roomReached: z.number().int(),
  durationSeconds: z.number().int(),
  seed: z.string(),
  gameVersion: z.string(),
  createdAt: IsoDateTime,
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  participants: z.array(AdminRunParticipant),
});
export type AdminRun = z.infer<typeof AdminRun>;

/** Number of runs in AdminPlayerDetail.recentRuns (newest first). */
export const ADMIN_PLAYER_RECENT_RUNS = 20;

export const AdminPlayerDetail = AdminPlayerListItem.extend({
  guild: z
    .object({ id: Uuid, name: z.string(), tag: z.string(), role: GuildRole })
    .nullable(),
  /** Full ban history, newest first (active and expired/revoked). */
  bans: z.array(AdminBan),
  /** The last ADMIN_PLAYER_RECENT_RUNS runs the player took part in, newest first. */
  recentRuns: z.array(AdminRun),
  /** All runs of the player (P-023; optional for older API builds). */
  runsTotal: z.number().int().optional(),
  /** Moderation notes on this player (P-023; optional for older API builds). */
  noteCount: z.number().int().optional(),
});
export type AdminPlayerDetail = z.infer<typeof AdminPlayerDetail>;

export const BanRequest = z.object({
  reason: z.string().trim().min(3).max(500),
  /** null = permanent. The admin panel offers 1, 7, 30 days or permanent. */
  durationDays: z.number().int().min(1).max(3650).nullable(),
});
export type BanRequest = z.infer<typeof BanRequest>;

/**
 * What happened at the relay after a ban (best effort, P-024): `disconnected` = open connections
 * were closed with `banned`, `not_connected` = the player was not online, `unavailable` = the relay
 * did not answer (the relay still rejects the player at the next `hello`/`create`/`join` once its
 * 30 s status cache has expired), `not_configured` = no RELAY_INTERNAL_URL.
 */
export const BanRelayResult = z.enum([
  "disconnected",
  "not_connected",
  "unavailable",
  "not_configured",
]);
export type BanRelayResult = z.infer<typeof BanRelayResult>;

/** 201 of POST /admin/players/:id/bans. */
export const BanResponse = z.object({
  id: Uuid,
  expiresAt: IsoDateTime.nullable(),
  /** Optional for older API builds. */
  relay: BanRelayResult.optional(),
});
export type BanResponse = z.infer<typeof BanResponse>;

// --- moderation notes (P-023) ----------------------------------------------------------------

/**
 * Internal note of the moderation team on a player (never shown to the player). GET/POST
 * /admin/players/:id/notes (moderator and admin), DELETE /admin/players/:id/notes/:noteId (admin
 * or the author; others 403 `forbidden`). Errors: 404 `not_found` (player), 404 `note_not_found`.
 * Audit: `player.note_add`, `player.note_delete` (with the text).
 */
export const AdminPlayerNote = z.object({
  id: Uuid,
  playerId: Uuid,
  text: z.string(),
  createdAt: IsoDateTime,
  /** Null if the author's admin account no longer exists. */
  authorId: Uuid.nullable(),
  authorEmail: z.string().nullable(),
});
export type AdminPlayerNote = z.infer<typeof AdminPlayerNote>;

/** Newest first. */
export const AdminPlayerNoteList = z.object({
  items: z.array(AdminPlayerNote),
});
export type AdminPlayerNoteList = z.infer<typeof AdminPlayerNoteList>;

export const CreatePlayerNoteRequest = z.object({
  text: z.string().trim().min(1).max(2000),
});
export type CreatePlayerNoteRequest = z.infer<typeof CreatePlayerNoteRequest>;

export const RenamePlayerRequest = z.object({ name: PlayerName });
export type RenamePlayerRequest = z.infer<typeof RenamePlayerRequest>;

// --- guilds -------------------------------------------------------------------------------------

export const AdminGuildStatusFilter = z.enum(["active", "disbanded", "all"]);
export type AdminGuildStatusFilter = z.infer<typeof AdminGuildStatusFilter>;

export const AdminGuildSearchQuery = AdminSearchQuery.extend({
  includeDisbanded: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * `active` (not disbanded), `disbanded` (only disbanded) or `all`; wins over `includeDisbanded`
   * when set (P-023). Without it: active only, or all with `includeDisbanded=true`.
   */
  status: AdminGuildStatusFilter.optional(),
});
export type AdminGuildSearchQuery = z.infer<typeof AdminGuildSearchQuery>;

export const AdminGuildListItem = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string(),
  memberCount: z.number().int(),
  founderName: z.string().nullable(),
  createdAt: IsoDateTime,
  disbandedAt: IsoDateTime.nullable(),
});
export type AdminGuildListItem = z.infer<typeof AdminGuildListItem>;

export const AdminGuildList = page(AdminGuildListItem);
export type AdminGuildList = z.infer<typeof AdminGuildList>;

export const AdminGuildDetail = AdminGuildListItem.extend({
  inviteCode: z.string(),
  founderId: Uuid.nullable(),
  members: z.array(GuildMember),
  progress: GuildProgress.nullable(),
});
export type AdminGuildDetail = z.infer<typeof AdminGuildDetail>;

export const RenameGuildRequest = z
  .object({ name: GuildName.optional(), tag: GuildTag.optional() })
  .refine((v) => v.name !== undefined || v.tag !== undefined, {
    message: "name or tag required",
  });
export type RenameGuildRequest = z.infer<typeof RenameGuildRequest>;

/**
 * POST /admin/guilds/:id/transfer (moderator and admin; audit `guild.transfer`): makes a member
 * the founder; the previous founder becomes officer. Errors: 404 `not_found` (guild), 409
 * `guild_disbanded`, 404 `not_a_member`, 409 `already_founder`.
 */
export const TransferGuildRequest = z.object({
  playerId: Uuid,
  reason: z.string().trim().min(3).max(500),
});
export type TransferGuildRequest = z.infer<typeof TransferGuildRequest>;

export const TransferGuildResponse = z.object({
  id: Uuid,
  founderId: Uuid,
  /** Null if the guild had no founder row (should not happen). */
  previousFounderId: Uuid.nullable(),
});
export type TransferGuildResponse = z.infer<typeof TransferGuildResponse>;

// --- runs ---------------------------------------------------------------------------------------

export const AdminRunsQuery = PaginationQuery.extend({
  flagged: z.enum(["true", "false"]).optional(),
  playerId: Uuid.optional(),
  guildId: Uuid.optional(),
});
export type AdminRunsQuery = z.infer<typeof AdminRunsQuery>;

export const AdminRunList = page(AdminRun);
export type AdminRunList = z.infer<typeof AdminRunList>;

export const FlagRunRequest = z.object({
  reason: z.string().trim().min(3).max(200),
});
export type FlagRunRequest = z.infer<typeof FlagRunRequest>;

// --- audit --------------------------------------------------------------------------------------

/** A point in time (ISO with offset) or a UTC calendar day ("2026-10-15"). */
export const AuditTime = z.union([IsoDateTime, z.iso.date()]);

export const AuditQuery = PaginationQuery.extend({
  adminId: Uuid.optional(),
  /** Exact action name, see AuditAction. */
  action: z.string().max(64).optional(),
  /** Action group, e.g. `player.` or `relay.` (prefix match; P-023). */
  actionPrefix: z.string().max(64).optional(),
  /** `player`, `guild`, `run`, `admin_user`, `relay_room`, ... (P-023). */
  targetType: z.string().max(64).optional(),
  targetId: z.string().max(64).optional(),
  /** Inclusive; a day means 00:00 UTC of that day (P-023). */
  from: AuditTime.optional(),
  /** Inclusive; a day means up to the end of that day (UTC) (P-023). */
  to: AuditTime.optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditEntry = z.object({
  id: Uuid,
  adminId: Uuid.nullable(),
  adminEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  details: z.unknown(),
  createdAt: IsoDateTime,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditList = page(AuditEntry);
export type AuditList = z.infer<typeof AuditList>;

// --- admin users --------------------------------------------------------------------------------

export const AdminUser = z.object({
  id: Uuid,
  email: z.string(),
  role: AdminRole,
  createdAt: IsoDateTime,
  disabledAt: IsoDateTime.nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserList = z.object({ items: z.array(AdminUser) });
export type AdminUserList = z.infer<typeof AdminUserList>;

export const CreateAdminUserRequest = z.object({
  email: AdminEmail,
  password: AdminPassword,
  role: AdminRole,
});
export type CreateAdminUserRequest = z.infer<typeof CreateAdminUserRequest>;

/**
 * Stable action names written to audit_log.action today. `AuditEntry.action` stays a plain
 * string, so rows with retired actions (`legal.refresh`, `legal.register_push_client`, removed
 * with P-025; `deletion_request.resolve`, removed with P-026) remain readable.
 */
export const AuditAction = z.enum([
  "player.ban",
  "player.unban",
  "player.rename",
  "player.delete",
  "guild.rename",
  "guild.remove_member",
  "guild.reset_invite_code",
  "guild.disband",
  "run.flag",
  "run.unflag",
  "run.delete",
  "admin.create",
  "admin.disable",
  "admin.enable",
  "player.note_add",
  "player.note_delete",
  "guild.transfer",
  "relay.room_close",
  "relay.kick",
  "admin.password_change",
  "admin.email_change",
]);
export type AuditAction = z.infer<typeof AuditAction>;

// --- live rooms on the relay (P-024) ---------------------------------------------------------

/**
 * GET /admin/relay/rooms (moderator and admin): the relay's `GET /internal/rooms`, passed
 * through. POST /admin/relay/rooms/:code/close `{ reason }` and POST
 * /admin/relay/rooms/:code/kick `{ playerId, reason }` (moderator and admin; audit
 * `relay.room_close` with target `relay_room`/code, `relay.kick` with target `player`).
 * Errors: 501 `relay_not_configured` (no RELAY_INTERNAL_URL/KEY), 502 `relay_unavailable` (relay
 * not reachable, timeout, wrong key, unexpected answer), 404 `room_not_found`, 404
 * `player_not_in_room`, 400 `validation_error`.
 */
export const AdminRelayRoomList = RelayRoomList;
export type AdminRelayRoomList = RelayRoomList;
export const AdminRelayCloseRoomRequest = RelayCloseRoomRequest;
export type AdminRelayCloseRoomRequest = RelayCloseRoomRequest;
export const AdminRelayCloseRoomResponse = RelayCloseRoomResponse;
export type AdminRelayCloseRoomResponse = RelayCloseRoomResponse;
export const AdminRelayKickRequest = RelayKickRequest;
export type AdminRelayKickRequest = RelayKickRequest;
export const AdminRelayKickResponse = RelayKickResponse;
export type AdminRelayKickResponse = RelayKickResponse;

// --- deletion log (P-026) ------------------------------------------------------------------------

/**
 * GET /admin/account-deletions (moderator and admin, read only); newest first. `from`/`to` like
 * the audit filter (a day means 00:00 UTC / end of that day, inclusive). `playerId` answers "was
 * this account deleted?" for support questions: the API hashes it like the log does; the id
 * itself is not stored.
 */
export const AdminAccountDeletionQuery = PaginationQuery.extend({
  from: AuditTime.optional(),
  to: AuditTime.optional(),
  channel: AccountDeletionChannel.optional(),
  playerId: Uuid.optional(),
});
export type AdminAccountDeletionQuery = z.infer<
  typeof AdminAccountDeletionQuery
>;

/** One deleted account. No name, no identity, no player id (P-026). */
export const AdminAccountDeletion = z.object({
  id: Uuid,
  deletedAt: IsoDateTime,
  channel: AccountDeletionChannel,
  /** The account had an active ban when it was deleted. */
  wasBanned: z.boolean(),
});
export type AdminAccountDeletion = z.infer<typeof AdminAccountDeletion>;

export const AccountDeletionChannelCounts = z.object({
  web_code: z.number().int().min(0),
  in_game: z.number().int().min(0),
  admin: z.number().int().min(0),
});
export type AccountDeletionChannelCounts = z.infer<
  typeof AccountDeletionChannelCounts
>;

/**
 * 200 of GET /admin/account-deletions. `total` matches all filters; `counts` per channel respect
 * `from`/`to`/`playerId` but not `channel`, so the panel can show all three numbers at once.
 */
export const AdminAccountDeletionList = page(AdminAccountDeletion).extend({
  counts: AccountDeletionChannelCounts,
});
export type AdminAccountDeletionList = z.infer<typeof AdminAccountDeletionList>;

/**
 * DELETE /admin/players/:id (role admin; writes audit `player.delete` and a deletion log row with
 * channel `admin`). Deletes the account like DELETE /me (identities, bans and run participations
 * go with it, guild membership is removed with the founder hand-over of P-102), also for banned
 * players (P-108). The body is optional; `note` goes into the audit entry. (`deletionRequestId`
 * was removed with P-026; it is ignored if an old admin build still sends it.)
 * Errors: 404 `player_not_found`.
 */
export const AdminDeletePlayerRequest = z.object({
  note: z.string().trim().max(500).optional(),
});
export type AdminDeletePlayerRequest = z.infer<typeof AdminDeletePlayerRequest>;

/** 200 of DELETE /admin/players/:id. */
export const AdminDeletePlayerResponse = z.object({
  /** Id of the deleted account (no longer exists). */
  id: Uuid,
  /** Name at deletion time. */
  name: z.string(),
  /** Guild the player was in, null if none. */
  guild: z
    .object({
      id: Uuid,
      tag: z.string(),
      /** The player was the last member, so the guild was disbanded. */
      disbanded: z.boolean(),
      /** Set when the player was the founder and the role passed on (P-102). */
      newFounderId: Uuid.nullable(),
    })
    .nullable(),
  /** The account had an active ban (P-026). */
  wasBanned: z.boolean(),
});
export type AdminDeletePlayerResponse = z.infer<
  typeof AdminDeletePlayerResponse
>;
