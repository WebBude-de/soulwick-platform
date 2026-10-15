import { z } from "zod";
import {
  GuildName,
  GuildRole,
  GuildTag,
  InviteCode,
  IsoDateTime,
  Uuid,
} from "./common.ts";

/** D-080 (TESTWERT). */
export const MAX_GUILD_MEMBERS = 30;

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
});
export type GuildMember = z.infer<typeof GuildMember>;

/** Forge upgrade id -> level. The ids are defined by the game (D-087). */
export const ForgeLevels = z.record(
  z.string().min(1).max(64),
  z.number().int().min(0).max(1000)
);
export type ForgeLevels = z.infer<typeof ForgeLevels>;

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
    treasury: z.number().int().min(0).max(2_000_000_000).optional(),
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

/** The caller's own guild. The invite code is visible to all members (to share it on Discord). */
export const OwnGuild = z.object({
  id: Uuid,
  name: z.string(),
  tag: z.string(),
  inviteCode: z.string(),
  founderId: Uuid.nullable(),
  createdAt: IsoDateTime,
  maxMembers: z.number().int(),
  members: z.array(GuildMember),
  progress: GuildProgress,
});
export type OwnGuild = z.infer<typeof OwnGuild>;

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
