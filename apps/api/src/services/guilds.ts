import {
  type ForgeLevels,
  type GuildProgress,
  MAX_GUILD_MEMBERS,
  type OwnGuild,
  type PlayerSelf,
} from "@soulwick/contracts";
import type { GuildRole, Player } from "@soulwick/db";
import { iso } from "../lib/validate.ts";
import type { DbOrTx, Tx } from "./db-types.ts";
import { findIdentities, steamIdOf } from "./identities.ts";

/** The player's membership in an active guild, or null. */
export async function findMembership(db: DbOrTx, playerId: string) {
  const row = await db.guildMember.findFirst({
    where: { playerId, guild: { disbandedAt: null } },
    include: { guild: { select: { name: true, tag: true } } },
  });
  return row
    ? {
        guildId: row.guildId,
        role: row.role,
        name: row.guild.name,
        tag: row.guild.tag,
      }
    : null;
}

export async function toPlayerSelf(
  db: DbOrTx,
  player: Player
): Promise<PlayerSelf> {
  const m = await findMembership(db, player.id);
  const identities = await findIdentities(db, player.id);
  return {
    id: player.id,
    name: player.name,
    steamId: steamIdOf(identities),
    createdAt: iso(player.createdAt),
    guild: m ? { id: m.guildId, name: m.name, tag: m.tag, role: m.role } : null,
  };
}

const ROLE_ORDER: Record<GuildRole, number> = {
  founder: 0,
  officer: 1,
  member: 2,
};

/** Founder first, then officers, then members; by join date within a role. */
export async function listMembers(db: DbOrTx, guildId: string) {
  const rows = await db.guildMember.findMany({
    where: { guildId },
    include: { player: { select: { name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows
    .toSorted((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    .map((r) => ({
      playerId: r.playerId,
      name: r.player.name,
      role: r.role,
      joinedAt: iso(r.joinedAt),
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

export async function loadOwnGuild(
  db: DbOrTx,
  guildId: string
): Promise<OwnGuild | null> {
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
    inviteCode: g.inviteCode,
    founderId: g.founderId,
    createdAt: iso(g.createdAt),
    maxMembers: MAX_GUILD_MEMBERS,
    members,
    progress: progress ?? emptyProgress(),
  };
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

/**
 * Removes a member. If the founder leaves, the longest-serving officer (else member) becomes
 * founder; if nobody is left, the guild is disbanded.
 */
export async function removeMember(
  tx: Tx,
  guildId: string,
  playerId: string,
  now: Date
): Promise<{
  removed: boolean;
  disbanded: boolean;
  newFounderId: string | null;
}> {
  const member = await tx.guildMember.findFirst({
    where: { guildId, playerId },
  });
  if (!member) {
    return { removed: false, disbanded: false, newFounderId: null };
  }
  await tx.guildMember.delete({ where: { playerId } });

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
      where: { playerId: successor.playerId },
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

export function memberCount(db: DbOrTx, guildId: string): Promise<number> {
  return db.guildMember.count({ where: { guildId } });
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
  const member = await tx.guildMember.findFirst({
    where: { guildId, playerId },
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
      where: { playerId: previous.playerId },
      data: { role: "officer" },
    });
  }
  await tx.guildMember.update({
    where: { playerId },
    data: { role: "founder" },
  });
  await tx.guild.update({
    where: { id: guildId },
    data: { founderId: playerId },
  });
  return { ok: true, previousFounderId: previous?.playerId ?? null };
}
