import { createHmac, randomInt } from "node:crypto";
import {
  type AccountSummary,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_SECONDS,
} from "@soulwick/contracts";
import type { Db, Player } from "@soulwick/db";
import { ApiError, isUniqueViolation, withCause } from "../lib/errors.ts";
import { iso } from "../lib/validate.ts";
import { findActiveBan } from "./bans.ts";
import type { Tx } from "./db-types.ts";
import { findMembership, removeMember } from "./guilds.ts";
import { findIdentities } from "./identities.ts";

const CODE_ATTEMPTS = 5;
/** Merging touches several tables; Prisma's default of 5 s is tight on a busy database. */
const MERGE_TIMEOUT_MS = 15_000;

export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

/** Only this HMAC is stored, so a database dump does not reveal active codes. */
export function hashLinkCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(`link-code:${code}`).digest("hex");
}

/**
 * Creates the account's link code (D-121): 6 characters, LINK_CODE_TTL_SECONDS valid, one per
 * player (a new code replaces the old one). Expired codes of all players are swept on the way.
 */
export async function createLinkCode(
  db: Db,
  playerId: string,
  secret: string,
  now: Date
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_SECONDS * 1000);
  await db.linkCode.deleteMany({ where: { expiresAt: { lte: now } } });
  // Retries one after the other on purpose: each attempt depends on the previous one failing.
  const attempt = async (
    left: number
  ): Promise<{ code: string; expiresAt: Date }> => {
    const code = generateLinkCode();
    const codeHash = hashLinkCode(code, secret);
    try {
      await db.linkCode.upsert({
        where: { playerId },
        create: { playerId, codeHash, createdAt: now, expiresAt },
        update: { codeHash, createdAt: now, expiresAt },
      });
      return { code, expiresAt };
    } catch (err) {
      // Another player holds the same active code (or a parallel request of the same player won
      // the upsert race): draw again.
      if (!isUniqueViolation(err)) {
        throw err;
      }
      if (left <= 1) {
        throw withCause(
          new ApiError(
            503,
            "link_code_unavailable",
            "No free link code, try again"
          ),
          err
        );
      }
      return await attempt(left - 1);
    }
  };
  return await attempt(CODE_ATTEMPTS);
}

async function summarize(tx: Tx, player: Player): Promise<AccountSummary> {
  const membership = await findMembership(tx, player.id);
  const runCount = await tx.runPlayer.count({ where: { playerId: player.id } });
  const identities = await findIdentities(tx, player.id);
  return {
    id: player.id,
    name: player.name,
    createdAt: iso(player.createdAt),
    guild: membership
      ? { name: membership.name, tag: membership.tag, role: membership.role }
      : null,
    runCount,
    providers: [...new Set(identities.map((i) => i.provider))],
  };
}

/** D-122: an account is empty when it has no guild and no runs. */
const hasProgress = (s: AccountSummary) => s.guild !== null || s.runCount > 0;

/**
 * Moves everything of `dropId` onto `keepId` and deletes `dropId` (D-122). Runs inside the
 * caller's transaction with both player rows locked.
 * - identities and ban history move over (an open deletion code of the dropped account goes with
 *   it; P-026);
 * - guild: keep's membership wins; the dropped account leaves its guild (founder hand-off per
 *   P-102). Without a guild of its own, keep takes over the dropped membership including the role
 *   (a founder stays founder, it is the same person);
 * - run participations move; a run both accounts took part in keeps one row; reporter moves;
 * - name and `created_at` of keep stay, `last_seen_at` becomes the later of both.
 */
async function absorbAccount(
  tx: Tx,
  keep: Player,
  drop: Player,
  now: Date
): Promise<{ guild: "kept" | "taken_over" | "left" | "none" }> {
  await tx.playerIdentity.updateMany({
    where: { playerId: drop.id },
    data: { playerId: keep.id },
  });

  let guild: "kept" | "taken_over" | "left" | "none" = "none";
  const keepMembership = await findMembership(tx, keep.id);
  const dropMembership = await findMembership(tx, drop.id);
  if (dropMembership && keepMembership) {
    await removeMember(tx, dropMembership.guildId, drop.id, now);
    guild = "left";
  } else if (dropMembership) {
    await tx.guildMember.updateMany({
      where: { playerId: drop.id },
      data: { playerId: keep.id },
    });
    if (dropMembership.role === "founder") {
      await tx.guild.update({
        where: { id: dropMembership.guildId },
        data: { founderId: keep.id },
      });
    }
    guild = "taken_over";
  } else if (keepMembership) {
    guild = "kept";
  }

  await tx.$executeRaw`
    delete from run_players d
    using run_players k
    where d.player_id = ${drop.id}::uuid
      and k.player_id = ${keep.id}::uuid
      and d.run_id = k.run_id`;
  await tx.runPlayer.updateMany({
    where: { playerId: drop.id },
    data: { playerId: keep.id },
  });
  await tx.run.updateMany({
    where: { reportedBy: drop.id },
    data: { reportedBy: keep.id },
  });
  await tx.ban.updateMany({
    where: { playerId: drop.id },
    data: { playerId: keep.id },
  });

  if (drop.lastSeenAt > keep.lastSeenAt) {
    await tx.player.update({
      where: { id: keep.id },
      data: { lastSeenAt: drop.lastSeenAt },
    });
  }
  await tx.player.delete({ where: { id: drop.id } });
  return { guild };
}

export interface LinkResult {
  guild: "kept" | "taken_over" | "left" | "none";
  merged: boolean;
  remaining: Player;
  /** true when the caller's own account was removed (its device continues on `remaining`). */
  removedCaller: boolean;
  removedPlayerId: string;
}

/**
 * POST /me/link (D-121, D-122), one transaction. `callerId` redeems the code of another account.
 * - empty caller account → absorbed into the code owner; empty owner account → absorbed into the
 *   caller; both empty → the caller's account is absorbed (the usual "second device" case);
 * - both with progress → 409 `account_has_progress` with both summaries unless `confirmMerge`;
 *   then the older account (`created_at`, tie: code owner) remains;
 * - either account banned → 409 `merge_blocked_banned` (an admin checks manually).
 */
export async function redeemLinkCode(
  db: Db,
  input: {
    callerId: string;
    code: string;
    confirmMerge: boolean;
    secret: string;
    now: Date;
  }
): Promise<LinkResult> {
  const { callerId, code, confirmMerge, secret, now } = input;
  const codeHash = hashLinkCode(code, secret);

  return await db.$transaction(
    async (tx) => {
      const row = await tx.linkCode.findUnique({ where: { codeHash } });
      if (!row) {
        throw new ApiError(404, "link_code_not_found", "Unknown link code");
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw new ApiError(410, "link_code_expired", "The link code expired");
      }
      if (row.playerId === callerId) {
        throw new ApiError(
          409,
          "already_linked",
          "This code belongs to your own account"
        );
      }

      // Fixed lock order (by id) so two crossing link attempts cannot deadlock.
      const ids = [row.playerId, callerId].toSorted();
      await tx.$queryRaw`select id from players where id in (${ids[0]}::uuid, ${ids[1]}::uuid) order by id for update`;
      const owner = await tx.player.findUnique({ where: { id: row.playerId } });
      const caller = await tx.player.findUnique({ where: { id: callerId } });
      if (!(owner && caller)) {
        throw new ApiError(404, "link_code_not_found", "Unknown link code");
      }

      if (
        (await findActiveBan(tx, owner.id, now)) ||
        (await findActiveBan(tx, caller.id, now))
      ) {
        throw new ApiError(
          409,
          "merge_blocked_banned",
          "One of the accounts is banned; the accounts cannot be linked"
        );
      }

      const ownerSummary = await summarize(tx, owner);
      const callerSummary = await summarize(tx, caller);
      let keep: Player;
      let drop: Player;
      let merged = false;
      if (!hasProgress(callerSummary)) {
        keep = owner;
        drop = caller;
      } else if (hasProgress(ownerSummary)) {
        const ownerIsOlder =
          owner.createdAt.getTime() <= caller.createdAt.getTime();
        keep = ownerIsOlder ? owner : caller;
        drop = ownerIsOlder ? caller : owner;
        if (!confirmMerge) {
          throw new ApiError(
            409,
            "account_has_progress",
            "Both accounts have progress; confirm the merge",
            {
              remaining: ownerIsOlder ? ownerSummary : callerSummary,
              removed: ownerIsOlder ? callerSummary : ownerSummary,
            }
          );
        }
        merged = true;
      } else {
        keep = caller;
        drop = owner;
      }

      const { guild } = await absorbAccount(tx, keep, drop, now);
      // The owner's code is used up (gone with the owner if the owner was absorbed).
      await tx.linkCode.deleteMany({ where: { id: row.id } });
      const remaining = await tx.player.findUniqueOrThrow({
        where: { id: keep.id },
      });
      return {
        remaining,
        removedPlayerId: drop.id,
        removedCaller: drop.id === caller.id,
        merged,
        guild,
      };
    },
    { timeout: MERGE_TIMEOUT_MS }
  );
}
