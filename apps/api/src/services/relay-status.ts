import type { RelayPlayerStatus } from "@soulwick/contracts";
import { findActiveBan } from "./bans.ts";
import type { DbOrTx } from "./db-types.ts";
import { findMembership } from "./guilds.ts";

/**
 * What the relay needs to admit a player (KONZEPT_ONLINE.md §2.7): ban status and guild
 * membership. Null if the player does not exist (deleted account with a still valid token).
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
  const [ban, membership] = await Promise.all([
    findActiveBan(db, player.id, now),
    findMembership(db, player.id),
  ]);
  const currentGuildId = membership?.guildId ?? null;
  return {
    playerId: player.id,
    name: player.name,
    banned: ban !== null,
    guildId: currentGuildId,
    guildMember: guildId === undefined ? null : currentGuildId === guildId,
  };
}
