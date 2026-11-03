import type { User } from "@soulwick/db";
import { PLAYER_ROLE, playerUserEmail } from "../auth/player-plugin.ts";
import type { DbOrTx } from "./db-types.ts";

/**
 * The Better Auth user row of a player (P-027): carries the sessions, the player's Better Auth
 * accounts (password hash, OAuth rows; P-037) and, once a magic link proved one, the player's
 * e-mail address (otherwise a placeholder on `.invalid`).
 */

/**
 * The user row of the player, created if missing. Insert-or-nothing in SQL, so it also works
 * inside a transaction while a parallel login creates the same row (no aborted transaction).
 */
export async function ensurePlayerUser(
  db: DbOrTx,
  playerId: string
): Promise<User> {
  await db.$executeRaw`
    insert into auth_users (name, email, role, player_id)
    values (${PLAYER_ROLE}, ${playerUserEmail(playerId)}, ${PLAYER_ROLE}, ${playerId}::uuid)
    on conflict (player_id) do nothing`;
  return await db.user.findUniqueOrThrow({ where: { playerId } });
}

/** The e-mail address proven for this player, or null (placeholder or no user row yet). */
export function realEmailOf(user: Pick<User, "email" | "playerId"> | null) {
  if (!user?.playerId) {
    return null;
  }
  return user.email === playerUserEmail(user.playerId) ? null : user.email;
}

/** Puts the placeholder back (the e-mail login was unlinked or moved to another account). */
export async function clearPlayerEmail(
  db: DbOrTx,
  playerId: string
): Promise<void> {
  await db.user.updateMany({
    where: { playerId },
    data: { email: playerUserEmail(playerId), emailVerified: false },
  });
}
