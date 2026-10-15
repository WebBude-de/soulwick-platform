import { randomInt } from "node:crypto";
import {
  ADMIN_NAME_HISTORY_LIMIT,
  type AdminPlayerDetail,
  MAX_NAME_CHANGES,
  NAME_CHANGE_WINDOW_HOURS,
  NAME_HISTORY_RETENTION_DAYS,
  PlayerAppearance,
} from "@soulwick/contracts";
import { type Player, Prisma } from "@soulwick/db";
import { ApiError } from "../lib/errors.ts";
import { iso } from "../lib/validate.ts";
import type { Db, DbOrTx, Tx } from "./db-types.ts";

/**
 * Account profile (P-034, D-152): one display name and one character per account. Save games are
 * only worlds and no longer name the account.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Name of a new account whose login sent no name: "Spieler-" plus four random digits. Random on
 * purpose: the device id is the secret of a guest account and must not leak into a public name.
 */
export const defaultPlayerName = () =>
  `Spieler-${String(randomInt(10_000)).padStart(4, "0")}`;

/** Stored appearance as the contract type; null for none or a value this build no longer knows. */
export function appearanceOf(
  value: Prisma.JsonValue | null
): PlayerAppearance | null {
  if (value === null) {
    return null;
  }
  const parsed = PlayerAppearance.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** For `create`/`update` data: null resets the column (SQL NULL), undefined leaves it. */
export function appearanceData(
  appearance: PlayerAppearance | null | undefined
): Prisma.InputJsonObject | typeof Prisma.DbNull | undefined {
  if (appearance === undefined) {
    return;
  }
  return appearance === null
    ? Prisma.DbNull
    : (appearance as unknown as Prisma.InputJsonObject);
}

/** Records a rename in the history (inside the caller's transaction). */
export async function recordNameChange(
  tx: Tx,
  input: {
    playerId: string;
    oldName: string;
    newName: string;
    now: Date;
    adminId?: string;
  }
): Promise<void> {
  await tx.playerNameChange.create({
    data: {
      playerId: input.playerId,
      oldName: input.oldName,
      newName: input.newName,
      changedAt: input.now,
      adminId: input.adminId ?? null,
    },
  });
}

/**
 * PATCH /me: sets name and/or appearance in one transaction. A new name counts against
 * MAX_NAME_CHANGES per NAME_CHANGE_WINDOW_HOURS (own changes only; admin renames do not count);
 * over the limit nothing is changed and 429 `name_change_limited` is thrown with `retryAfter`.
 */
export async function updateProfile(
  db: Db,
  input: {
    playerId: string;
    name?: string;
    appearance?: PlayerAppearance | null;
    now: Date;
  }
): Promise<Player> {
  const { playerId, now } = input;
  return await db.$transaction(async (tx) => {
    // Serialises parallel renames of the same player, so the limit cannot be raced.
    await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
    const current = await tx.player.findUniqueOrThrow({
      where: { id: playerId },
    });
    const rename = input.name !== undefined && input.name !== current.name;
    if (rename) {
      const since = new Date(
        now.getTime() - NAME_CHANGE_WINDOW_HOURS * HOUR_MS
      );
      const recent = await tx.playerNameChange.findMany({
        where: { playerId, adminId: null, changedAt: { gt: since } },
        orderBy: { changedAt: "asc" },
        select: { changedAt: true },
      });
      if (recent.length >= MAX_NAME_CHANGES) {
        const oldest = recent.at(-MAX_NAME_CHANGES)?.changedAt ?? now;
        const retryAfter = Math.max(
          1,
          Math.ceil(
            (oldest.getTime() +
              NAME_CHANGE_WINDOW_HOURS * HOUR_MS -
              now.getTime()) /
              1000
          )
        );
        throw new ApiError(
          429,
          "name_change_limited",
          `At most ${MAX_NAME_CHANGES} name changes per ${NAME_CHANGE_WINDOW_HOURS} hours`,
          { retryAfter }
        );
      }
      await recordNameChange(tx, {
        playerId,
        oldName: current.name,
        newName: input.name as string,
        now,
      });
    }
    const appearance = appearanceData(input.appearance);
    if (!rename && appearance === undefined) {
      return current;
    }
    return await tx.player.update({
      where: { id: playerId },
      data: {
        ...(rename ? { name: input.name } : {}),
        ...(appearance === undefined ? {} : { appearance }),
      },
    });
  });
}

/** Newest first, for AdminPlayerDetail.nameHistory. */
export async function nameHistoryOf(
  db: DbOrTx,
  playerId: string
): Promise<NonNullable<AdminPlayerDetail["nameHistory"]>> {
  const rows = await db.playerNameChange.findMany({
    where: { playerId },
    orderBy: { changedAt: "desc" },
    take: ADMIN_NAME_HISTORY_LIMIT,
  });
  return rows.map((r) => ({
    oldName: r.oldName,
    newName: r.newName,
    changedAt: iso(r.changedAt),
    byAdmin: r.adminId !== null,
  }));
}

/** Housekeeping: name changes older than NAME_HISTORY_RETENTION_DAYS go. */
export async function deleteOldNameChanges(
  db: DbOrTx,
  now: Date
): Promise<number> {
  const { count } = await db.playerNameChange.deleteMany({
    where: {
      changedAt: {
        lt: new Date(now.getTime() - NAME_HISTORY_RETENTION_DAYS * DAY_MS),
      },
    },
  });
  return count;
}
