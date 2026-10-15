import { z } from "zod";
import { IsoDateTime, RunMode, Uuid } from "./common.ts";
import { GuildProgress } from "./guild.ts";
import { RunEndReason } from "./lobby.ts";

/** Max players in one run (D-084: 1–4). */
export const MAX_RUN_PARTICIPANTS = 4;

/** Run gold left at the end that one run report may carry (sanity bound, TESTWERT). */
export const MAX_RUN_REMAINING_GOLD = 10_000_000;
/** Share of the remaining run gold paid into the guild treasury when the run did not end at the portal (D-081, D-062). */
export const GUILD_RUN_LOSS_PAYOUT_RATIO = 0.5;

/**
 * Guild treasury payout of a guild run (D-081, same rule as the game's RunManager, D-062):
 * portal = 100 %, otherwise 50 % rounded up. Missing `endReason` counts as a loss.
 */
export function guildRunPayout(
  remainingGold: number,
  endReason: RunEndReason | undefined
): number {
  if (remainingGold <= 0) {
    return 0;
  }
  return endReason === "portal"
    ? remainingGold
    : Math.ceil(remainingGold * GUILD_RUN_LOSS_PAYOUT_RATIO);
}

/** Reported by the host at the end of a run. The reporting player must be one of the participants. */
export const CreateRunRequest = z
  .object({
    mode: RunMode,
    guildId: Uuid.optional(),
    participants: z.array(Uuid).min(1).max(MAX_RUN_PARTICIPANTS),
    roomReached: z.number().int().min(0).max(100_000),
    durationSeconds: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 3600),
    seed: z.string().trim().min(1).max(64),
    gameVersion: z.string().trim().min(1).max(32),
    /**
     * How the run ended (optional, added with D-147): `portal` (exit reached), `wiped`, `abandoned`.
     * Decides the guild payout ratio; missing = loss (50 %).
     */
    endReason: RunEndReason.optional(),
    /**
     * Shared run gold left at the end (optional, added with D-147). Guild runs pay
     * `guildRunPayout(remainingGold, endReason)` into the guild treasury; ignored for other modes.
     */
    remainingGold: z
      .number()
      .int()
      .min(0)
      .max(MAX_RUN_REMAINING_GOLD)
      .optional(),
    /**
     * Idempotency key (optional, P-032): a UUID the host creates once per run and sends again on
     * every retry. A repeated report with the same `reportId` answers 200 with the stored result and
     * pays nothing a second time. Another player's `reportId` → 409 `report_id_conflict`.
     */
    reportId: Uuid.optional(),
  })
  .refine((r) => new Set(r.participants).size === r.participants.length, {
    message: "participants must be unique",
    path: ["participants"],
  })
  .refine((r) => (r.mode === "guild") === (r.guildId !== undefined), {
    message: "guildId is required for mode guild and not allowed otherwise",
    path: ["guildId"],
  })
  .refine((r) => r.mode !== "solo" || r.participants.length === 1, {
    message: "solo runs have exactly one participant",
    path: ["participants"],
  });
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

/**
 * 201 of `POST /runs` (200 when the same `reportId` was reported before: the stored run, its
 * `guildPayout` and the guild's current progress; nothing is paid again). Errors: 400
 * `validation_error`, 422 `reporter_not_participant`, 422 `unknown_participants`, 403
 * `not_guild_member` (guild run reported by a non-member, or the guild does not exist / is
 * disbanded), 409 `report_id_conflict` (the `reportId` belongs to another player's report).
 */
export const CreateRunResponse = z.object({
  id: Uuid,
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  createdAt: IsoDateTime,
  /**
   * Gold paid into the guild treasury by this run (guild runs with `remainingGold`); 0 for flagged
   * guild runs, null for other runs or without `remainingGold`. Optional for older API builds.
   */
  guildPayout: z.number().int().min(0).nullable().optional(),
  /** Guild progress after the payout (guild runs only, else null). Optional for older API builds. */
  guildProgress: GuildProgress.nullable().optional(),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;
