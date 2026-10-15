import { createHmac, randomInt, randomUUID } from "node:crypto";
import {
  type AccountDeletionChannel,
  type AccountDeletionPreview,
  type AdminDeletedGuildMembership,
  type AdminDeletePlayerResponse,
  DELETION_CODE_LENGTH,
  DELETION_CODE_MAX_ATTEMPTS,
  DELETION_CODE_TTL_SECONDS,
  DELETION_TOKEN_TTL_SECONDS,
  type DeletionCode,
  LINK_CODE_ALPHABET,
} from "@soulwick/contracts";
import {
  ApiError,
  isRecordNotFound,
  isUniqueViolation,
  withCause,
} from "../lib/errors.ts";
import { forEachSequential } from "../lib/sequential.ts";
import { signDeletionToken, verifyDeletionToken } from "../lib/tokens.ts";
import { writeAudit } from "./audit.ts";
import { findActiveBan } from "./bans.ts";
import { countBugReportsOf } from "./bug-reports.ts";
import type { Db, Tx } from "./db-types.ts";
import { findMemberships, removeMember } from "./guilds.ts";

/**
 * Automatic account deletion (P-026, KONZEPT_ONLINE.md §3.7): one-time deletion codes for the
 * website, the confirmation token, the shared delete logic of all channels and the deletion log.
 */

const CODE_ATTEMPTS = 5;
/** Deleting touches several tables; Prisma's default of 5 s is tight on a busy database. */
const DELETE_TIMEOUT_MS = 15_000;

export function generateDeletionCode(): string {
  let code = "";
  for (let i = 0; i < DELETION_CODE_LENGTH; i += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

/** Only this HMAC is stored, so a database dump does not reveal active codes. */
export function hashDeletionCode(code: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`deletion-code:${code}`)
    .digest("hex");
}

/**
 * Pseudonym of a deleted account in the deletion log: lets support answer "was account X
 * deleted?" without storing the id. Changes when BETTER_AUTH_SECRET is rotated (lib/secrets.ts).
 */
export function deletionLogHash(playerId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`account-deletion-log:${playerId}`)
    .digest("hex");
}

/**
 * POST /me/deletion-code: a fresh code, DELETION_CODE_TTL_SECONDS valid, one per player. A new
 * code replaces the row *including its id*, so confirmation tokens issued for the old code stop
 * working, and resets the failed attempts.
 */
export async function createDeletionCode(
  db: Db,
  playerId: string,
  secret: string,
  now: Date
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + DELETION_CODE_TTL_SECONDS * 1000);
  // Retries one after the other on purpose: each attempt depends on the previous one failing.
  const attempt = async (
    left: number
  ): Promise<{ code: string; expiresAt: Date }> => {
    const code = generateDeletionCode();
    const codeHash = hashDeletionCode(code, secret);
    const fields = { codeHash, createdAt: now, expiresAt, failedAttempts: 0 };
    try {
      await db.deletionCode.upsert({
        where: { playerId },
        create: { playerId, ...fields },
        update: { id: randomUUID(), ...fields },
      });
      return { code, expiresAt };
    } catch (err) {
      // Another player holds the same code hash (or a parallel request of the same player won
      // the upsert race): draw again.
      if (!isUniqueViolation(err)) {
        throw err;
      }
      if (left <= 1) {
        throw withCause(
          new ApiError(
            503,
            "deletion_code_unavailable",
            "No free deletion code, try again"
          ),
          err
        );
      }
      return await attempt(left - 1);
    }
  };
  return await attempt(CODE_ATTEMPTS);
}

const invalidCode = () =>
  new ApiError(
    400,
    "invalid_deletion_code",
    "Player name and deletion code do not match"
  );

const sameName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * POST /account-deletion/verify: checks player name + code and issues the confirmation token.
 * Every failure gives the same `invalid_deletion_code`, whether the name exists or not. A wrong
 * code counts as a failed attempt for every player of that name with an active code; at
 * DELETION_CODE_MAX_ATTEMPTS their code stops working (the player creates a new one in the game).
 */
export async function verifyDeletionCode(
  db: Db,
  input: {
    playerName: string;
    code: DeletionCode;
    secret: string;
    now: Date;
  }
): Promise<{
  token: string;
  expiresAt: Date;
  account: AccountDeletionPreview;
}> {
  const { playerName, code, secret, now } = input;
  const row = await db.deletionCode.findUnique({
    where: { codeHash: hashDeletionCode(code, secret) },
    include: { player: { select: { id: true, name: true } } },
  });
  const valid =
    row !== null &&
    row.expiresAt > now &&
    row.failedAttempts < DELETION_CODE_MAX_ATTEMPTS &&
    sameName(row.player.name, playerName);
  if (!valid) {
    await db.deletionCode.updateMany({
      where: {
        expiresAt: { gt: now },
        player: { name: { equals: playerName, mode: "insensitive" } },
      },
      data: { failedAttempts: { increment: 1 } },
    });
    throw invalidCode();
  }
  const memberships = await findMemberships(db, row.player.id);
  const guilds = memberships.map((m) => ({
    name: m.name,
    tag: m.tag,
    role: m.role,
  }));
  const runCount = await db.runPlayer.count({
    where: { playerId: row.player.id },
  });
  const bugReportCount = await countBugReportsOf(db, row.player.id);
  const { token, expiresAt } = await signDeletionToken(
    row.player.id,
    row.id,
    secret,
    DELETION_TOKEN_TTL_SECONDS,
    now
  );
  return {
    token,
    expiresAt,
    account: {
      playerName: row.player.name,
      guild: memberships[0]
        ? { name: memberships[0].name, tag: memberships[0].tag }
        : null,
      guilds,
      runCount,
      bugReportCount,
    },
  };
}

/** The account had an active ban in `wasBanned` (deletion is allowed anyway, privacy; P-026). */
export type DeletedAccount = Pick<
  AdminDeletePlayerResponse,
  "guild" | "wasBanned"
> & { guilds: AdminDeletedGuildMembership[] };

/**
 * Deletes an account; the one implementation behind DELETE /me, the website confirmation and
 * DELETE /admin/players/:id. Guild membership is removed first (founder role passes on, P-102;
 * the last member disbands the guild); identities, bans, link and deletion codes, notes, bug reports and run
 * participation rows go with the player (ON DELETE CASCADE), so runs stay for guild boards but
 * no longer reference the player. Writes the deletion log row (no name, P-026).
 */
export async function deletePlayerAccount(
  tx: Tx,
  input: {
    playerId: string;
    channel: AccountDeletionChannel;
    secret: string;
    now: Date;
  }
): Promise<DeletedAccount> {
  const { playerId, channel, secret, now } = input;
  const wasBanned = (await findActiveBan(tx, playerId, now)) !== null;
  // Every guild the player is in (D-147), one after the other: each hand-over is independent.
  const guilds: AdminDeletedGuildMembership[] = [];
  await forEachSequential(
    await findMemberships(tx, playerId),
    async (membership) => {
      const result = await removeMember(tx, membership.guildId, playerId, now);
      guilds.push({
        id: membership.guildId,
        tag: membership.tag,
        disbanded: result.disbanded,
        newFounderId: result.newFounderId,
      });
    }
  );
  await tx.player.delete({ where: { id: playerId } });
  await tx.accountDeletion.create({
    data: {
      deletedAt: now,
      channel,
      wasBanned,
      playerHash: deletionLogHash(playerId, secret),
    },
  });
  return { guild: guilds[0] ?? null, guilds, wasBanned };
}

const invalidToken = () =>
  new ApiError(
    400,
    "deletion_token_invalid",
    "The confirmation is invalid or expired; start again with a new deletion code"
  );

/**
 * POST /account-deletion/confirm: uses up the code the token was issued for and deletes the
 * account in one transaction. Two confirmations at once cannot both win (the code row is deleted
 * conditionally, the second one finds nothing).
 */
export async function confirmAccountDeletion(
  db: Db,
  input: { token: string; secret: string; now: Date }
): Promise<DeletedAccount> {
  const claims = await verifyDeletionToken(
    input.token,
    input.secret,
    input.now
  );
  if (!claims) {
    throw invalidToken();
  }
  try {
    return await db.$transaction(
      async (tx) => {
        const { count } = await tx.deletionCode.deleteMany({
          where: { id: claims.codeId, playerId: claims.playerId },
        });
        if (count === 0) {
          throw invalidToken();
        }
        return await deletePlayerAccount(tx, {
          playerId: claims.playerId,
          channel: "web_code",
          secret: input.secret,
          now: input.now,
        });
      },
      { timeout: DELETE_TIMEOUT_MS }
    );
  } catch (err) {
    // The account disappeared in between (e.g. deleted in the game at the same moment).
    if (isRecordNotFound(err)) {
      throw withCause(invalidToken(), err);
    }
    throw err;
  }
}

/** DELETE /me: the logged-in player deletes the own account (P-108: not while banned). */
export async function deleteOwnAccount(
  db: Db,
  input: { playerId: string; secret: string; now: Date }
): Promise<DeletedAccount> {
  return await db.$transaction(
    (tx) => deletePlayerAccount(tx, { ...input, channel: "in_game" }),
    { timeout: DELETE_TIMEOUT_MS }
  );
}

const playerNotFound = () =>
  new ApiError(404, "player_not_found", "Player not found");

/**
 * Admin deletion of an account (DELETE /admin/players/:id), also for banned players (P-108). The
 * audit entry `player.delete` keeps the name at deletion time and the admin's note, no identity
 * ids; the deletion log gets a row with channel `admin`.
 */
export async function adminDeletePlayer(
  db: Db,
  input: {
    playerId: string;
    adminId: string;
    note?: string;
    secret: string;
    now: Date;
  }
): Promise<AdminDeletePlayerResponse> {
  try {
    return await db.$transaction(
      async (tx) => {
        const player = await tx.player.findUnique({
          where: { id: input.playerId },
          select: { id: true, name: true },
        });
        if (!player) {
          throw playerNotFound();
        }
        const { guild, guilds, wasBanned } = await deletePlayerAccount(tx, {
          playerId: player.id,
          channel: "admin",
          secret: input.secret,
          now: input.now,
        });
        await writeAudit(tx, {
          adminId: input.adminId,
          action: "player.delete",
          targetType: "player",
          targetId: player.id,
          details: {
            name: player.name,
            ...(input.note ? { note: input.note } : {}),
            ...(guild
              ? { guildId: guild.id, guildDisbanded: guild.disbanded }
              : {}),
            ...(guilds.length > 1
              ? {
                  guilds: guilds.map((g) => ({
                    id: g.id,
                    disbanded: g.disbanded,
                  })),
                }
              : {}),
          },
        });
        return { id: player.id, name: player.name, guild, guilds, wasBanned };
      },
      { timeout: DELETE_TIMEOUT_MS }
    );
  } catch (err) {
    // Another admin deleted the account between the lookup and the delete.
    if (isRecordNotFound(err)) {
      throw withCause(playerNotFound(), err);
    }
    throw err;
  }
}
