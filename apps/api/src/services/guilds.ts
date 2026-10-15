import {
  type CreateGuildRequest,
  type ForgeLevels,
  type GuildDetail,
  type GuildProgress,
  type GuildSummary,
  type LeaveGuildResponse,
  MAX_GUILD_MEMBERS,
  MAX_GUILD_TREASURY,
  MAX_GUILDS_PER_PLAYER,
  type PatchGuildProgressRequest,
  type PlayerSelf,
  type SetGuildRoleRequest,
} from "@soulwick/contracts";
import type { GuildRole, Player } from "@soulwick/db";
import {
  ApiError,
  isRecordNotFound,
  isUniqueViolation,
  withCause,
} from "../lib/errors.ts";
import { generateInviteCode } from "../lib/invite-code.ts";
import { iso } from "../lib/validate.ts";
import type { Db, DbOrTx, Tx } from "./db-types.ts";
import { findIdentities, steamIdOf } from "./identities.ts";
import { appearanceOf } from "./profile.ts";

/**
 * Guilds (D-080, D-081, D-147, P-031): a player is in up to MAX_GUILDS_PER_PLAYER active guilds,
 * a guild has up to MAX_GUILD_MEMBERS members. Founder = all rights; officer = invite code and
 * removing plain members; member = read, leave, progress.
 */

export interface Membership {
  guildId: string;
  joinedAt: Date;
  name: string;
  role: GuildRole;
  tag: string;
}

// --- errors ---------------------------------------------------------------------------------------

const notMember = () =>
  new ApiError(403, "not_member", "You are not a member of this guild");
const forbiddenRole = (message: string) =>
  new ApiError(403, "forbidden_role", message);
const memberNotFound = () =>
  new ApiError(404, "member_not_found", "Player is not a member of this guild");
const cannotTargetSelf = () =>
  new ApiError(
    400,
    "cannot_target_self",
    "Not possible on yourself; use leave instead"
  );
const guildLimitReached = () =>
  new ApiError(
    409,
    "guild_limit_reached",
    `You are already in ${MAX_GUILDS_PER_PLAYER} guilds`
  );
const alreadyMember = () =>
  new ApiError(409, "already_member", "You are already in this guild");

// --- reading --------------------------------------------------------------------------------------

/** All active guild memberships of the player, oldest first. */
export async function findMemberships(
  db: DbOrTx,
  playerId: string
): Promise<Membership[]> {
  const rows = await db.guildMember.findMany({
    where: { playerId, guild: { disbandedAt: null } },
    include: { guild: { select: { name: true, tag: true } } },
    orderBy: [{ joinedAt: "asc" }, { guildId: "asc" }],
  });
  return rows.map((row) => ({
    guildId: row.guildId,
    role: row.role,
    joinedAt: row.joinedAt,
    name: row.guild.name,
    tag: row.guild.tag,
  }));
}

/** The player's oldest active membership, or null (single-guild fields kept for older clients). */
export async function findMembership(
  db: DbOrTx,
  playerId: string
): Promise<Membership | null> {
  const [first] = await findMemberships(db, playerId);
  return first ?? null;
}

/** The player's membership in this guild if the guild is active, else null. */
export async function findMembershipIn(
  db: DbOrTx,
  guildId: string,
  playerId: string
): Promise<{ role: GuildRole } | null> {
  return await db.guildMember.findFirst({
    where: { guildId, playerId, guild: { disbandedAt: null } },
    select: { role: true },
  });
}

export async function toPlayerSelf(
  db: DbOrTx,
  player: Player
): Promise<PlayerSelf> {
  const memberships = await findMemberships(db, player.id);
  const identities = await findIdentities(db, player.id);
  const guilds = memberships.map((m) => ({
    id: m.guildId,
    name: m.name,
    tag: m.tag,
    role: m.role,
  }));
  return {
    id: player.id,
    name: player.name,
    steamId: steamIdOf(identities),
    createdAt: iso(player.createdAt),
    guild: guilds[0] ?? null,
    guilds,
    appearance: appearanceOf(player.appearance),
  };
}

const ROLE_ORDER: Record<GuildRole, number> = {
  founder: 0,
  officer: 1,
  member: 2,
};

/** The higher of two roles (founder > officer > member). */
export const higherRole = (a: GuildRole, b: GuildRole): GuildRole =>
  ROLE_ORDER[a] <= ROLE_ORDER[b] ? a : b;

/** Founder first, then officers, then members; by join date within a role. */
export async function listMembers(db: DbOrTx, guildId: string) {
  const rows = await db.guildMember.findMany({
    where: { guildId },
    include: { player: { select: { name: true, appearance: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows
    .toSorted((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    .map((r) => ({
      playerId: r.playerId,
      name: r.player.name,
      role: r.role,
      joinedAt: iso(r.joinedAt),
      appearance: appearanceOf(r.player.appearance),
    }));
}

export const emptyProgress = (): GuildProgress => ({
  treasury: 0,
  forgeLevels: {},
  version: 0,
});

export async function getProgress(
  db: DbOrTx,
  guildId: string
): Promise<GuildProgress | null> {
  const row = await db.guildProgress.findUnique({ where: { guildId } });
  return row
    ? {
        treasury: row.treasury,
        forgeLevels: row.forgeLevels as ForgeLevels,
        version: row.version,
      }
    : null;
}

/** Guild as its member `myRole` sees it; the invite code only for founder and officers. */
export async function loadGuildDetail(
  db: DbOrTx,
  guildId: string,
  myRole: GuildRole
): Promise<GuildDetail | null> {
  const g = await db.guild.findUnique({ where: { id: guildId } });
  if (!g || g.disbandedAt) {
    return null;
  }
  const members = await listMembers(db, guildId);
  const progress = await getProgress(db, guildId);
  return {
    id: g.id,
    name: g.name,
    tag: g.tag,
    inviteCode: myRole === "member" ? null : g.inviteCode,
    founderId: g.founderId,
    createdAt: iso(g.createdAt),
    maxMembers: MAX_GUILD_MEMBERS,
    myRole,
    members,
    progress: progress ?? emptyProgress(),
  };
}

/** GET /me/guilds: own active guilds with member count and treasury, oldest membership first. */
export async function listMyGuilds(
  db: DbOrTx,
  playerId: string
): Promise<GuildSummary[]> {
  const rows = await db.guildMember.findMany({
    where: { playerId, guild: { disbandedAt: null } },
    include: {
      guild: {
        select: {
          name: true,
          tag: true,
          progress: { select: { treasury: true } },
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: [{ joinedAt: "asc" }, { guildId: "asc" }],
  });
  return rows.map((r) => ({
    id: r.guildId,
    name: r.guild.name,
    tag: r.guild.tag,
    myRole: r.role,
    memberCount: r.guild._count.members,
    maxMembers: MAX_GUILD_MEMBERS,
    joinedAt: iso(r.joinedAt),
    treasury: r.guild.progress?.treasury ?? 0,
  }));
}

/** Tag and name per guild id (also disbanded guilds), e.g. for the live rooms in the admin panel. */
export async function guildLabels(
  db: DbOrTx,
  guildIds: readonly string[]
): Promise<Map<string, { name: string; tag: string }>> {
  if (guildIds.length === 0) {
    return new Map();
  }
  const rows = await db.guild.findMany({
    where: { id: { in: [...new Set(guildIds)] } },
    select: { id: true, name: true, tag: true },
  });
  return new Map(rows.map((r) => [r.id, { name: r.name, tag: r.tag }]));
}

export function memberCount(db: DbOrTx, guildId: string): Promise<number> {
  return db.guildMember.count({ where: { guildId } });
}

/** Caller's role in an active guild; 403 `not_member` otherwise (also for unknown guild ids). */
export async function requireMember(
  db: DbOrTx,
  guildId: string,
  playerId: string
): Promise<GuildRole> {
  const m = await findMembershipIn(db, guildId, playerId);
  if (!m) {
    throw notMember();
  }
  return m.role;
}

/** Detail for a member; 403 `not_member` if the caller is not (or no longer) in the guild. */
export async function guildDetailFor(
  db: DbOrTx,
  guildId: string,
  playerId: string
): Promise<GuildDetail> {
  const role = await requireMember(db, guildId, playerId);
  const detail = await loadGuildDetail(db, guildId, role);
  if (!detail) {
    throw notMember();
  }
  return detail;
}

// --- writing --------------------------------------------------------------------------------------

/**
 * Serialises guild changes of one player (create, join, account merge) so the guild limit
 * cannot be exceeded by parallel requests.
 */
async function lockPlayer(tx: Tx, playerId: string): Promise<void> {
  await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
}

async function assertBelowGuildLimit(tx: Tx, playerId: string): Promise<void> {
  const count = await tx.guildMember.count({
    where: { playerId, guild: { disbandedAt: null } },
  });
  if (count >= MAX_GUILDS_PER_PLAYER) {
    throw guildLimitReached();
  }
}

/**
 * Prisma does not know the two partial indexes on guilds (see packages/db/prisma/schema.prisma),
 * so after a unique violation we look up whether name or tag collided.
 */
async function guildCreateConflict(
  db: Db,
  err: unknown,
  body: { name: string; tag: string }
): Promise<ApiError> {
  const nameTaken = await db.guild.findFirst({
    where: {
      disbandedAt: null,
      name: { equals: body.name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (nameTaken) {
    return withCause(
      new ApiError(409, "guild_name_taken", "Guild name is already taken"),
      err
    );
  }
  return withCause(
    new ApiError(409, "guild_tag_taken", "Guild tag is already taken"),
    err
  );
}

/** POST /guilds: the caller becomes founder; returns the new guild id. */
export async function createGuild(
  db: Db,
  playerId: string,
  body: CreateGuildRequest
): Promise<string> {
  try {
    return await db.$transaction(async (tx) => {
      await lockPlayer(tx, playerId);
      await assertBelowGuildLimit(tx, playerId);
      const created = await tx.guild.create({
        data: {
          name: body.name,
          tag: body.tag,
          inviteCode: generateInviteCode(),
          founderId: playerId,
          members: { create: { playerId, role: "founder" } },
          progress: { create: {} },
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw err;
    }
    throw await guildCreateConflict(db, err, body);
  }
}

/** POST /guilds/join: returns the guild id. Checks: code, already member, own limit, guild full. */
export async function joinGuild(
  db: Db,
  playerId: string,
  inviteCode: string
): Promise<string> {
  try {
    return await db.$transaction(async (tx) => {
      // Lock order player -> guild, the same in every path that takes both.
      await lockPlayer(tx, playerId);
      // Row lock serialises concurrent joins so the member cap cannot be exceeded.
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`select id from guilds where invite_code = ${inviteCode} and disbanded_at is null for update`;
      const g = rows[0];
      if (!g) {
        throw new ApiError(404, "invalid_invite_code", "Invite code not found");
      }
      if (await findMembershipIn(tx, g.id, playerId)) {
        throw alreadyMember();
      }
      await assertBelowGuildLimit(tx, playerId);
      const count = await tx.guildMember.count({ where: { guildId: g.id } });
      if (count >= MAX_GUILD_MEMBERS) {
        throw new ApiError(
          409,
          "guild_full",
          `Guild already has ${MAX_GUILD_MEMBERS} members`
        );
      }
      await tx.guildMember.create({
        data: { guildId: g.id, playerId, role: "member" },
      });
      return g.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw withCause(alreadyMember(), err);
    }
    throw err;
  }
}

/** Marks the guild as disbanded, removes all members and invalidates the invite code. */
export async function disbandGuild(
  tx: Tx,
  guildId: string,
  now: Date
): Promise<void> {
  await tx.guildMember.deleteMany({ where: { guildId } });
  await tx.guild.update({
    where: { id: guildId },
    data: {
      disbandedAt: now,
      founderId: null,
      inviteCode: `X-${crypto.randomUUID()}`,
    },
  });
}

export interface RemoveResult {
  disbanded: boolean;
  newFounderId: string | null;
  removed: boolean;
}

/**
 * Removes a member. If the founder leaves, the longest-serving officer (else member) becomes
 * founder (P-102); if nobody is left, the guild is disbanded.
 */
export async function removeMember(
  tx: Tx,
  guildId: string,
  playerId: string,
  now: Date
): Promise<RemoveResult> {
  const member = await tx.guildMember.findUnique({
    where: { guildId_playerId: { guildId, playerId } },
  });
  if (!member) {
    return { removed: false, disbanded: false, newFounderId: null };
  }
  await tx.guildMember.delete({
    where: { guildId_playerId: { guildId, playerId } },
  });

  const remaining = await tx.guildMember.findMany({
    where: { guildId },
    orderBy: { joinedAt: "asc" },
    select: { playerId: true, role: true },
  });
  const successor = remaining.find((m) => m.role === "officer") ?? remaining[0];

  if (!successor) {
    await disbandGuild(tx, guildId, now);
    return { removed: true, disbanded: true, newFounderId: null };
  }
  if (member.role === "founder") {
    await tx.guildMember.update({
      where: { guildId_playerId: { guildId, playerId: successor.playerId } },
      data: { role: "founder" },
    });
    await tx.guild.update({
      where: { id: guildId },
      data: { founderId: successor.playerId },
    });
    return {
      removed: true,
      disbanded: false,
      newFounderId: successor.playerId,
    };
  }
  return { removed: true, disbanded: false, newFounderId: null };
}

/** POST /guilds/:id/leave. */
export async function leaveGuild(
  db: Db,
  guildId: string,
  playerId: string,
  now: Date
): Promise<LeaveGuildResponse> {
  return await db.$transaction(async (tx) => {
    await requireMember(tx, guildId, playerId);
    const r = await removeMember(tx, guildId, playerId, now);
    return { guildId, disbanded: r.disbanded, newFounderId: r.newFounderId };
  });
}

/**
 * DELETE /guilds/:id/members/:playerId: the founder removes anybody, an officer only plain
 * members (P-031).
 */
export async function kickMember(
  db: Db,
  guildId: string,
  callerId: string,
  targetId: string,
  now: Date
): Promise<void> {
  await db.$transaction(async (tx) => {
    const role = await requireMember(tx, guildId, callerId);
    if (role === "member") {
      throw forbiddenRole("Only founder and officers can remove members");
    }
    if (targetId === callerId) {
      throw cannotTargetSelf();
    }
    const target = await findMembershipIn(tx, guildId, targetId);
    if (!target) {
      throw memberNotFound();
    }
    if (role === "officer" && target.role !== "member") {
      throw forbiddenRole("Officers can only remove members");
    }
    await removeMember(tx, guildId, targetId, now);
  });
}

/** PATCH /guilds/:id/members/:playerId: founder only, officer <-> member. */
export async function setMemberRole(
  db: Db,
  guildId: string,
  callerId: string,
  targetId: string,
  body: SetGuildRoleRequest
): Promise<void> {
  await db.$transaction(async (tx) => {
    const role = await requireMember(tx, guildId, callerId);
    if (role !== "founder") {
      throw forbiddenRole("Only the founder can change roles");
    }
    if (targetId === callerId) {
      throw cannotTargetSelf();
    }
    if (!(await findMembershipIn(tx, guildId, targetId))) {
      throw memberNotFound();
    }
    await tx.guildMember.update({
      where: { guildId_playerId: { guildId, playerId: targetId } },
      data: { role: body.role },
    });
  });
}

/** POST /guilds/:id/invite-code: founder and officers; the old code stops working. */
export async function rotateInviteCode(
  db: Db,
  guildId: string,
  callerId: string
): Promise<string> {
  const role = await requireMember(db, guildId, callerId);
  if (role === "member") {
    throw forbiddenRole("Only founder and officers can renew the invite code");
  }
  const inviteCode = generateInviteCode();
  await db.guild.update({ where: { id: guildId }, data: { inviteCode } });
  return inviteCode;
}

/**
 * PATCH /guilds/:id/progress, any member (P-104). Optimistic concurrency: applies only if
 * `version` matches; otherwise `{ conflict: current }` for the 409 answer.
 */
export async function patchProgress(
  db: Db,
  guildId: string,
  body: PatchGuildProgressRequest
): Promise<{ progress: GuildProgress } | { conflict: GuildProgress }> {
  try {
    const updated = await db.guildProgress.update({
      where: { guildId, version: body.version },
      data: {
        ...(body.treasury === undefined ? {} : { treasury: body.treasury }),
        ...(body.forgeLevels === undefined
          ? {}
          : { forgeLevels: body.forgeLevels }),
        version: { increment: 1 },
      },
    });
    return {
      progress: {
        treasury: updated.treasury,
        forgeLevels: updated.forgeLevels as ForgeLevels,
        version: updated.version,
      },
    };
  } catch (err) {
    if (!isRecordNotFound(err)) {
      throw err;
    }
    return {
      conflict: (await getProgress(db, guildId)) ?? emptyProgress(),
    };
  }
}

/**
 * Pays a guild run into the treasury (D-081): adds `amount` (clamped to MAX_GUILD_TREASURY) and
 * bumps the version, so a client holding the old version re-reads before spending.
 */
export async function creditTreasury(
  tx: Tx,
  guildId: string,
  amount: number
): Promise<GuildProgress> {
  const rows = await tx.$queryRaw<
    { treasury: number; forge_levels: unknown; version: number }[]
  >`insert into guild_progress (guild_id, treasury)
    values (${guildId}::uuid, least(${amount}::int, ${MAX_GUILD_TREASURY}::int))
    on conflict (guild_id) do update
      set treasury = least(guild_progress.treasury::bigint + ${amount}::bigint, ${MAX_GUILD_TREASURY}::bigint)::int,
          version = guild_progress.version + 1
    returning treasury, forge_levels, version`;
  const row = rows[0];
  if (!row) {
    throw new Error("guild_progress upsert returned no row");
  }
  return {
    treasury: Number(row.treasury),
    forgeLevels: row.forge_levels as ForgeLevels,
    version: Number(row.version),
  };
}

/**
 * Hands the founder role to a member (admin panel, P-023); the previous founder becomes officer.
 * `not_a_member` / `already_founder` are returned, not thrown, so the route picks the status.
 */
export async function transferFounder(
  tx: Tx,
  guildId: string,
  playerId: string
): Promise<
  | { ok: true; previousFounderId: string | null }
  | { ok: false; reason: "not_a_member" | "already_founder" }
> {
  const member = await tx.guildMember.findUnique({
    where: { guildId_playerId: { guildId, playerId } },
  });
  if (!member) {
    return { ok: false, reason: "not_a_member" };
  }
  if (member.role === "founder") {
    return { ok: false, reason: "already_founder" };
  }
  const previous = await tx.guildMember.findFirst({
    where: { guildId, role: "founder" },
    select: { playerId: true },
  });
  if (previous) {
    await tx.guildMember.update({
      where: { guildId_playerId: { guildId, playerId: previous.playerId } },
      data: { role: "officer" },
    });
  }
  await tx.guildMember.update({
    where: { guildId_playerId: { guildId, playerId } },
    data: { role: "founder" },
  });
  await tx.guild.update({
    where: { id: guildId },
    data: { founderId: playerId },
  });
  return { ok: true, previousFounderId: previous?.playerId ?? null };
}
