import { z } from "zod";
import {
  GuildName,
  GuildRole,
  GuildTag,
  InviteCode,
  IsoDateTime,
  PlayerAppearance,
  Uuid,
} from "./common.ts";

/** D-080 (TESTWERT). */
export const MAX_GUILD_MEMBERS = 30;
/** D-147 (TESTWERT): a player can be a member of up to this many active guilds at once. */
export const MAX_GUILDS_PER_PLAYER = 5;

/**
 * Player guild routes (D-147, P-031). All need `Authorization: Bearer <session token>`.
 *
 * | Route                                   | Body                        | 2xx                       |
 * | `GET /me/guilds`                        | -                           | 200 `MyGuildList`         |
 * | `POST /guilds`                          | `CreateGuildRequest`        | 201 `GuildDetail`         |
 * | `POST /guilds/join`                     | `JoinGuildRequest`          | 200 `GuildDetail`         |
 * | `GET /guilds/:id`                       | -                           | 200 `GuildDetail`         |
 * | `POST /guilds/:id/leave`                | -                           | 200 `LeaveGuildResponse`  |
 * | `DELETE /guilds/:id/members/:playerId`  | -                           | 200 `GuildDetail`         |
 * | `PATCH /guilds/:id/members/:playerId`   | `SetGuildRoleRequest`       | 200 `GuildDetail`         |
 * | `POST /guilds/:id/invite-code`          | -                           | 200 `RotateInviteCodeResponse` |
 * | `GET /guilds/:id/progress`              | -                           | 200 `GuildProgress`       |
 * | `PATCH /guilds/:id/progress`            | `PatchGuildProgressRequest` | 200 `GuildProgress`       |
 *
 * Error codes (`ErrorResponse.error`): 400 `validation_error`, 403 `not_member` (caller is not a
 * member of `:id`, or the guild does not exist / is disbanded), 403 `forbidden_role`, 404
 * `invalid_invite_code`, 404 `member_not_found` (target of kick/role change), 400
 * `cannot_target_self`, 409 `guild_limit_reached`, 409 `guild_full`, 409 `already_member`,
 * 409 `guild_name_taken`, 409 `guild_tag_taken`, 409 `version_conflict` (PATCH progress).
 *
 * Rights (P-031): founder = everything; officer = rotate the invite code, see it, remove plain
 * members; member = read, leave, progress. The former single-guild routes `/guilds/me*` and
 * `POST /guilds/leave` were removed with API_VERSION 1.1.0 (no game build used them).
 */

export const CreateGuildRequest = z.object({
  name: GuildName,
  tag: GuildTag,
});
export type CreateGuildRequest = z.infer<typeof CreateGuildRequest>;

export const JoinGuildRequest = z.object({
  inviteCode: InviteCode,
});
export type JoinGuildRequest = z.infer<typeof JoinGuildRequest>;

export const GuildMember = z.object({
  playerId: Uuid,
  name: z.string(),
  role: GuildRole,
  joinedAt: IsoDateTime,
  /** The member's character (P-034); null = default character. Optional for older API builds. */
  appearance: PlayerAppearance.nullable().optional(),
});
export type GuildMember = z.infer<typeof GuildMember>;

/** Forge upgrade id -> level. The ids are defined by the game (D-087). */
export const ForgeLevels = z.record(
  z.string().min(1).max(64),
  z.number().int().min(0).max(1000)
);
export type ForgeLevels = z.infer<typeof ForgeLevels>;

/** Upper bound of the guild treasury (PATCH and run payouts are clamped to it). */
export const MAX_GUILD_TREASURY = 2_000_000_000;

export const GuildProgress = z.object({
  treasury: z.number().int().min(0),
  forgeLevels: ForgeLevels,
  /** Optimistic concurrency token; send it back unchanged with PATCH. */
  version: z.number().int().min(0),
});
export type GuildProgress = z.infer<typeof GuildProgress>;

/**
 * New absolute values, applied only if `version` still matches. Otherwise HTTP 409
 * `version_conflict` with the current progress (client re-reads and retries).
 * Omitted fields stay unchanged.
 */
export const PatchGuildProgressRequest = z
  .object({
    version: z.number().int().min(0),
    treasury: z.number().int().min(0).max(MAX_GUILD_TREASURY).optional(),
    forgeLevels: ForgeLevels.optional(),
  })
  .refine((v) => v.treasury !== undefined || v.forgeLevels !== undefined, {
    message: "treasury or forgeLevels required",
  });
export type PatchGuildProgressRequest = z.infer<
  typeof PatchGuildProgressRequest
>;

export const VersionConflictResponse = z.object({
  error: z.literal("version_conflict"),
  current: GuildProgress,
});
export type VersionConflictResponse = z.infer<typeof VersionConflictResponse>;

/**
 * One guild of the caller (`GET /guilds/:id`, also the answer of create, join, kick and role
 * change). Only members can read it.
 */
export const GuildDetail = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string(),
  /** Visible to founder and officers; null for plain members (P-031). */
  inviteCode: z.string().nullable(),
  founderId: Uuid.nullable(),
  createdAt: IsoDateTime,
  maxMembers: z.number().int(),
  /** The caller's role in this guild. */
  myRole: GuildRole,
  /** Founder first, then officers, then members; by join date within a role. */
  members: z.array(GuildMember),
  progress: GuildProgress,
});
export type GuildDetail = z.infer<typeof GuildDetail>;

/** @deprecated Former answer of `GET /guilds/me`; use `GuildDetail`. */
export const OwnGuild = GuildDetail;
/** @deprecated Use `GuildDetail`. */
export type OwnGuild = GuildDetail;

/** Short form of one own guild for the list in the online menu (D-147). */
export const GuildSummary = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string(),
  myRole: GuildRole,
  memberCount: z.number().int().min(0),
  maxMembers: z.number().int(),
  joinedAt: IsoDateTime,
  /** Current guild treasury (gold). */
  treasury: z.number().int().min(0),
});
export type GuildSummary = z.infer<typeof GuildSummary>;

/** `GET /me/guilds`: own active guilds, oldest membership first. */
export const MyGuildList = z.object({
  items: z.array(GuildSummary),
  /** MAX_GUILDS_PER_PLAYER of this API. */
  maxGuilds: z.number().int(),
});
export type MyGuildList = z.infer<typeof MyGuildList>;

/** `POST /guilds/:id/leave`. */
export const LeaveGuildResponse = z.object({
  guildId: Uuid,
  /** The caller was the last member, so the guild was disbanded. */
  disbanded: z.boolean(),
  /** Set when the caller was the founder and the role passed on (P-102). */
  newFounderId: Uuid.nullable(),
});
export type LeaveGuildResponse = z.infer<typeof LeaveGuildResponse>;

/**
 * `PATCH /guilds/:id/members/:playerId` (founder only): make a member officer or back. The
 * founder role moves only by leaving (P-102) or through the admin panel.
 */
export const SetGuildRoleRequest = z.object({
  role: z.enum(["officer", "member"]),
});
export type SetGuildRoleRequest = z.infer<typeof SetGuildRoleRequest>;

export const RotateInviteCodeResponse = z.object({
  inviteCode: z.string(),
});
export type RotateInviteCodeResponse = z.infer<typeof RotateInviteCodeResponse>;

export const PublicGuildBestRun = z.object({
  roomReached: z.number().int(),
  durationSeconds: z.number().int(),
  achievedAt: IsoDateTime,
});
export type PublicGuildBestRun = z.infer<typeof PublicGuildBestRun>;

/** `GET /public/guilds/:tag` – no invite code, no player ids. */
export const PublicGuild = z.object({
  name: z.string(),
  tag: z.string(),
  memberCount: z.number().int(),
  createdAt: IsoDateTime,
  bestRun: PublicGuildBestRun.nullable(),
});
export type PublicGuild = z.infer<typeof PublicGuild>;
