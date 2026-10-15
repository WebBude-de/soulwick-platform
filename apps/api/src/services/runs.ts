import {
  type CreateRunRequest,
  type CreateRunResponse,
  guildRunPayout,
} from "@soulwick/contracts";
import type { Config } from "../config.ts";
import { ApiError, isUniqueViolation } from "../lib/errors.ts";
import { iso } from "../lib/validate.ts";
import type { Db } from "./db-types.ts";
import { creditTreasury, emptyProgress, getProgress } from "./guilds.ts";
import { checkPlausibility } from "./plausibility.ts";

/**
 * POST /runs (D-082, P-106, P-032). Checks: the reporter takes part, all participants exist; guild
 * runs only from members of an active guild (else 403 `not_guild_member`), other non-members
 * flag the run (`participant_not_in_guild`). A guild run with `remainingGold` pays into the
 * treasury (D-081: portal 100 %, else 50 % rounded up); flagged runs pay nothing. Run,
 * participants and payout are written in one transaction.
 *
 * `reportId` makes retries safe (P-032): a known id answers 200 with the stored run, its payout
 * and the guild's current progress, without paying again (also when two retries race: the unique
 * index lets one insert win, the other one rolls back including its payout).
 */
export async function reportRun(
  db: Db,
  input: {
    body: CreateRunRequest;
    config: Config;
    reporterId: string;
    createdAt?: Date;
  }
): Promise<{ status: 200 | 201; body: CreateRunResponse }> {
  const { body, reporterId } = input;
  if (body.reportId) {
    const stored = await storedReport(db, body.reportId, reporterId);
    if (stored) {
      return { status: 200, body: stored };
    }
  }
  try {
    return { status: 201, body: await createRun(db, input) };
  } catch (err) {
    if (!(body.reportId && isUniqueViolation(err, "report_id"))) {
      throw err;
    }
    const stored = await storedReport(db, body.reportId, reporterId);
    if (!stored) {
      throw err;
    }
    return { status: 200, body: stored };
  }
}

/** The run already reported under `reportId`; 409 if another player reported it. */
async function storedReport(
  db: Db,
  reportId: string,
  reporterId: string
): Promise<CreateRunResponse | null> {
  const run = await db.run.findUnique({ where: { reportId } });
  if (!run) {
    return null;
  }
  if (run.reportedBy !== reporterId) {
    throw new ApiError(
      409,
      "report_id_conflict",
      "This reportId belongs to another report"
    );
  }
  return {
    id: run.id,
    flagged: run.flagged,
    flagReason: run.flagReason,
    createdAt: iso(run.createdAt),
    guildPayout: run.guildPayout,
    guildProgress: run.guildId
      ? ((await getProgress(db, run.guildId)) ?? emptyProgress())
      : null,
  };
}

async function createRun(
  db: Db,
  input: {
    body: CreateRunRequest;
    config: Config;
    reporterId: string;
    createdAt?: Date;
  }
): Promise<CreateRunResponse> {
  const { body, config, reporterId } = input;
  if (!body.participants.includes(reporterId)) {
    throw new ApiError(
      422,
      "reporter_not_participant",
      "The reporting player must be a participant"
    );
  }
  const known = await db.player.findMany({
    where: { id: { in: body.participants } },
    select: { id: true },
  });
  if (known.length !== body.participants.length) {
    const knownIds = new Set(known.map((p) => p.id));
    throw new ApiError(
      422,
      "unknown_participants",
      "Some participants do not exist",
      {
        details: body.participants.filter((id) => !knownIds.has(id)),
      }
    );
  }

  const reasons: string[] = [];
  const plausibility = checkPlausibility(body, config);
  if (plausibility) {
    reasons.push(plausibility);
  }

  const guildId = body.mode === "guild" ? (body.guildId ?? null) : null;
  if (guildId) {
    const members = await db.guildMember.findMany({
      where: {
        guildId,
        playerId: { in: body.participants },
        guild: { disbandedAt: null },
      },
      select: { playerId: true },
    });
    const memberIds = new Set(members.map((m) => m.playerId));
    if (!memberIds.has(reporterId)) {
      throw new ApiError(
        403,
        "not_guild_member",
        "Only members can report guild runs"
      );
    }
    // D-080: only members may take part in a guild run.
    if (memberIds.size !== body.participants.length) {
      reasons.push("participant_not_in_guild");
    }
  }

  const flagReason = reasons.length > 0 ? reasons.join(",") : null;
  let payout: number | null = null;
  if (guildId && body.remainingGold !== undefined) {
    payout =
      flagReason === null
        ? guildRunPayout(body.remainingGold, body.endReason)
        : 0;
  }

  return await db.$transaction(async (tx) => {
    const created = await tx.run.create({
      data: {
        mode: body.mode,
        guildId,
        reportedBy: reporterId,
        roomReached: body.roomReached,
        durationSeconds: body.durationSeconds,
        seed: body.seed,
        gameVersion: body.gameVersion,
        flagged: flagReason !== null,
        flagReason,
        reportId: body.reportId ?? null,
        guildPayout: payout,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        participants: {
          create: body.participants.map((playerId) => ({ playerId })),
        },
      },
    });
    let guildProgress: CreateRunResponse["guildProgress"] = null;
    if (guildId) {
      guildProgress =
        payout && payout > 0
          ? await creditTreasury(tx, guildId, payout)
          : ((await getProgress(tx, guildId)) ?? emptyProgress());
    }
    return {
      id: created.id,
      flagged: created.flagged,
      flagReason: created.flagReason,
      createdAt: iso(created.createdAt),
      guildPayout: payout,
      guildProgress,
    };
  });
}
