import type {
  GuildRoom,
  GuildRoomList,
  RelayRoomSummary,
} from "@soulwick/contracts";
import { ApiError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import type { RelayClient } from "../lib/relay-client.ts";
import type { DbOrTx } from "./db-types.ts";
import { requireMember } from "./guilds.ts";

/** Rooms of this guild that still have a free slot (started ones included, the game decides). */
function openGuildRooms(
  rooms: readonly RelayRoomSummary[],
  guildId: string
): RelayRoomSummary[] {
  return rooms.filter(
    (r) =>
      r.mode === "guild" &&
      r.guildId === guildId &&
      r.playerCount < r.maxPlayers
  );
}

/** Current names from the database; the relay only knows the name from the player's `hello`. */
async function playerNames(
  db: DbOrTx,
  rooms: readonly RelayRoomSummary[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rooms.flatMap((r) => r.players.map((p) => p.playerId))),
  ];
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db.player.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function toGuildRoom(
  room: RelayRoomSummary,
  names: ReadonlyMap<string, string>
): GuildRoom | null {
  const host = room.players.find((p) => p.host);
  if (!host) {
    return null;
  }
  const nameOf = (p: { playerId: string; name: string | null }) =>
    names.get(p.playerId) ?? p.name;
  return {
    code: room.code,
    hostName: nameOf(host),
    hostPlayerId: host.playerId,
    playerCount: room.playerCount,
    maxPlayers: room.maxPlayers,
    started: room.started,
    gameVersion: room.gameVersion,
    players: room.players.map((p) => ({
      playerId: p.playerId,
      name: nameOf(p),
      host: p.host,
    })),
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
  };
}

/**
 * GET /guilds/:id/rooms: open guild rooms on the relay for a member of the guild (403
 * `not_member` otherwise). Relay problems never fail the request: without a configured or
 * reachable relay the list is empty and `relayAvailable` false (failures are logged).
 */
export async function listGuildRooms(
  db: DbOrTx,
  relay: RelayClient,
  logger: Logger,
  guildId: string,
  playerId: string,
  now: Date
): Promise<GuildRoomList> {
  await requireMember(db, guildId, playerId);
  const unavailable: GuildRoomList = {
    time: now.toISOString(),
    relayAvailable: false,
    rooms: [],
  };
  if (!relay.configured) {
    return unavailable;
  }
  let rooms: RelayRoomSummary[];
  try {
    rooms = openGuildRooms((await relay.listRooms()).rooms, guildId);
  } catch (err) {
    logger.error("relay_guild_rooms_failed", {
      guildId,
      error: err instanceof ApiError ? err.message : String(err),
    });
    return unavailable;
  }
  const names = await playerNames(db, rooms);
  return {
    time: now.toISOString(),
    relayAvailable: true,
    rooms: rooms.flatMap((r) => toGuildRoom(r, names) ?? []),
  };
}
