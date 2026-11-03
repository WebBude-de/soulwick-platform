import {
  ACCOUNT_STATE_FUTURE_TOLERANCE_SECONDS,
  ACCOUNT_STATE_MAX_SEEN,
  type AccountState,
  levelForXp,
  type PutAccountStateRequest,
  type PutAccountStateResponse,
  type TalentLevels,
  talentPointsForLevel,
  talentPointsSpent,
} from "@soulwick/contracts";
import type { AccountState as AccountStateRow, Prisma } from "@soulwick/db";
import { ApiError } from "../lib/errors.ts";
import { iso, isoOrNull } from "../lib/validate.ts";
import type { Db, DbOrTx, Tx } from "./db-types.ts";
import { dangerOf, recentRuns } from "./xp.ts";

/**
 * Account state (D-194, KF3b; contract account-state.ts): talents, equipped spells and seen flags
 * at the account. The build (talents + spells) follows "last change wins" by the device's
 * `changedAt` (capped to the server time), the seen flags are a union. Level, talent points,
 * danger level, rank and the recent runs are derived on every read, never stored here.
 */

/** Only levels >= 1, keys sorted: what is stored and answered. */
function normalizeTalents(talents: Readonly<Record<string, number>>) {
  return Object.fromEntries(
    Object.entries(talents)
      .filter(([, level]) => level > 0)
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
  ) as TalentLevels;
}

const unite = (...lists: readonly (readonly string[])[]) =>
  [...new Set(lists.flat())].toSorted();

/** The device time of a change, but never later than the server clock (plus tolerance). */
function capChangedAt(changedAt: string, now: Date): Date {
  const at = new Date(changedAt);
  return at.getTime() >
    now.getTime() + ACCOUNT_STATE_FUTURE_TOLERANCE_SECONDS * 1000
    ? now
    : at;
}

const talentsOf = (row: AccountStateRow | null): TalentLevels =>
  normalizeTalents((row?.talents ?? {}) as Record<string, number>);

/** The answer of GET and PUT /me/state for a player with `xp` total XP. */
async function toAccountState(
  db: DbOrTx,
  playerId: string,
  xp: number,
  row: AccountStateRow | null
): Promise<AccountState> {
  const runs = (await recentRuns(db, [playerId])).get(playerId) ?? [];
  const level = levelForXp(xp);
  const talents = talentsOf(row);
  return {
    talents,
    spells: row?.spells ?? [],
    changedAt: isoOrNull(row?.changedAt),
    seen: row?.seen.toSorted() ?? [],
    updatedAt: isoOrNull(row?.updatedAt),
    level,
    talentPoints: talentPointsForLevel(level),
    talentPointsSpent: talentPointsSpent(talents),
    ...dangerOf(xp, runs),
    recentRuns: runs.map((r) => ({
      runId: r.runId,
      deepestRoom: r.deepestRoom,
      danger: r.danger,
      endedAt: iso(r.endedAt),
    })),
  };
}

/** GET /me/state. */
export async function getAccountState(
  db: DbOrTx,
  player: { id: string; xp: number }
): Promise<AccountState> {
  const row = await db.accountState.findUnique({
    where: { playerId: player.id },
  });
  return await toAccountState(db, player.id, player.xp, row);
}

/**
 * PUT /me/state, one transaction with the player row locked (two devices writing at once cannot
 * lose a seen flag). Checks the points against the server level and the seen limit before
 * anything is stored (409 `talent_points_exceeded` / `seen_limit_reached`).
 */
export async function putAccountState(
  db: Db,
  input: { playerId: string; body: PutAccountStateRequest; now: Date }
): Promise<PutAccountStateResponse> {
  const { playerId, body, now } = input;
  return await db.$transaction(async (tx) => {
    await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
    const player = await tx.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { xp: true },
    });
    const row = await tx.accountState.findUnique({ where: { playerId } });

    let build: {
      talents: TalentLevels;
      spells: string[];
      changedAt: Date;
    } | null = null;
    if (body.talents && body.spells && body.changedAt) {
      const talents = normalizeTalents(body.talents);
      const level = levelForXp(player.xp);
      const spent = talentPointsSpent(talents);
      if (spent > talentPointsForLevel(level)) {
        throw new ApiError(
          409,
          "talent_points_exceeded",
          "The talents need more points than the account level gives; upload open XP first",
          {
            level,
            talentPoints: talentPointsForLevel(level),
            talentPointsSpent: spent,
          }
        );
      }
      const changedAt = capChangedAt(body.changedAt, now);
      // Last change wins; the same time again (a retry) is applied once more, harmlessly.
      if (!row?.changedAt || changedAt.getTime() >= row.changedAt.getTime()) {
        build = { talents, spells: body.spells, changedAt };
      }
    }

    const seen = unite(row?.seen ?? [], body.seen ?? []);
    if (seen.length > ACCOUNT_STATE_MAX_SEEN) {
      throw new ApiError(
        409,
        "seen_limit_reached",
        `An account keeps at most ${ACCOUNT_STATE_MAX_SEEN} seen flags`,
        { maxSeen: ACCOUNT_STATE_MAX_SEEN }
      );
    }

    const data = {
      seen,
      updatedAt: now,
      ...(build
        ? {
            talents: build.talents as Prisma.InputJsonObject,
            spells: build.spells,
            changedAt: build.changedAt,
          }
        : {}),
    };
    const saved = await tx.accountState.upsert({
      where: { playerId },
      create: { playerId, ...data },
      update: data,
    });
    return {
      ...(await toAccountState(tx, playerId, player.xp, saved)),
      talentsApplied: build !== null,
    };
  });
}

/**
 * Merge (D-122, D-194): the build that was changed later stays (keep's on a tie or when neither
 * has one), the seen flags are united (beyond ACCOUNT_STATE_MAX_SEEN keep's flags first, then
 * drop's in sort order). The merged XP are at least keep's, so the kept build stays
 * within its points. Runs inside the caller's transaction with both player rows locked; drop's
 * row goes with the account (cascade).
 */
export async function mergeAccountState(
  tx: Tx,
  keepId: string,
  dropId: string,
  now: Date
): Promise<void> {
  const [keep, drop] = await Promise.all([
    tx.accountState.findUnique({ where: { playerId: keepId } }),
    tx.accountState.findUnique({ where: { playerId: dropId } }),
  ]);
  if (!drop) {
    return;
  }
  const dropBuildWins =
    drop.changedAt !== null &&
    (!keep?.changedAt || drop.changedAt.getTime() > keep.changedAt.getTime());
  const winner = dropBuildWins ? drop : keep;
  const keepSeen = unite(keep?.seen ?? []);
  const extraSeen = unite(drop.seen).filter((f) => !keepSeen.includes(f));
  const data = {
    talents: talentsOf(winner) as Prisma.InputJsonObject,
    spells: winner?.spells ?? [],
    changedAt: winner?.changedAt ?? null,
    seen: unite(
      keepSeen,
      extraSeen.slice(0, Math.max(0, ACCOUNT_STATE_MAX_SEEN - keepSeen.length))
    ),
    updatedAt: now,
  };
  await tx.accountState.upsert({
    where: { playerId: keepId },
    create: { playerId: keepId, ...data },
    update: data,
  });
}
