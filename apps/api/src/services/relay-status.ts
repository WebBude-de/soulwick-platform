import type { RelayPlayerStatus } from "@soulwick/contracts";
import { findActiveBan } from "./bans.ts";
import type { DbOrTx } from "./db-types.ts";
import { findMemberships } from "./guilds.ts";

/**
 * What the relay needs to admit a player (KONZEPT_ONLINE.md §2.7): ban status and guild
 * memberships (D-147, P-031: `guildIds` lists every active guild). Null if the player does not
 * exist (deleted account with a still valid token).
 */
export async function getRelayPlayerStatus(
  db: DbOrTx,
  playerId: string,
  guildId: string | undefined,
  now: Date
): Promise<RelayPlayerStatus | null> {
  const player = await db.player.findUnique({
    where: { id: playerId },
    select: { id: true, name: true },
  });
  if (!player) {
    return null;
  }
  const [ban, memberships] = await Promise.all([
    findActiveBan(db, player.id, now),
    findMemberships(db, player.id),
  ]);
  const guildIds = memberships.map((m) => m.guildId);
  return {
    playerId: player.id,
    name: player.name,
    banned: ban !== null,
    guildId: guildIds[0] ?? null,
    guildMember: guildId === undefined ? null : guildIds.includes(guildId),
    guildIds,
  };
}
