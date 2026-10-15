import { z } from "zod";
import { IsoDateTime, RunMode, Uuid } from "./common.ts";

/** Max players in one run (D-084: 1–4). */
export const MAX_RUN_PARTICIPANTS = 4;

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

export const CreateRunResponse = z.object({
  id: Uuid,
  flagged: z.boolean(),
  flagReason: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;
