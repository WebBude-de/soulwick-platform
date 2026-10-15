import { z } from "zod";
import {
  IsoDateTime,
  LeaderboardKind,
  LeaderboardPeriod,
  SeasonId,
  Uuid,
} from "./common.ts";

export const LeaderboardQuery = z.object({
  period: LeaderboardPeriod.default("all"),
  /** Only used for period=season; defaults to the current UTC month. */
  season: SeasonId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuery>;

export const LeaderboardEntry = z.object({
  /** Ties (same room and duration) share a rank. */
  rank: z.number().int().min(1),
  /** Player id (solo/group) or guild id (guild). */
  id: Uuid,
  name: z.string(),
  /**
   * Guild tag: the guild itself (guild board) or the player's oldest active guild (player boards;
   * D-147 allows several).
   */
  tag: z.string().nullable(),
  roomReached: z.number().int(),
  durationSeconds: z.number().int(),
  runId: Uuid,
  achievedAt: IsoDateTime,
  /** Guild board only, otherwise null. */
  memberCount: z.number().int().nullable(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const LeaderboardResponse = z.object({
  kind: LeaderboardKind,
  period: LeaderboardPeriod,
  season: SeasonId.nullable(),
  entries: z.array(LeaderboardEntry),
  /**
   * Own entry (player boards) or the best placed of the own guilds (guild board) when called with
   * a player token.
   */
  own: LeaderboardEntry.nullable(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;
