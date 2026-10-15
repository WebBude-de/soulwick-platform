import type { CreateRunRequest } from "@soulwick/contracts";
import type { Config } from "../config.ts";

/**
 * Server-side sanity checks for host-reported runs (D-082). Suspicious runs are stored but
 * flagged, so they do not appear on leaderboards and admins can review them.
 * Returns null if the run looks plausible, otherwise a short machine-readable reason.
 */
export function checkPlausibility(
  run: Pick<
    CreateRunRequest,
    "roomReached" | "durationSeconds" | "gameVersion"
  >,
  config: Pick<Config, "MIN_SECONDS_PER_ROOM" | "KNOWN_GAME_VERSIONS">
): string | null {
  const reasons: string[] = [];
  if (
    run.roomReached > 0 &&
    run.durationSeconds < run.roomReached * config.MIN_SECONDS_PER_ROOM
  ) {
    reasons.push("too_fast");
  }
  if (
    config.KNOWN_GAME_VERSIONS.length > 0 &&
    !config.KNOWN_GAME_VERSIONS.includes(run.gameVersion)
  ) {
    reasons.push("unknown_game_version");
  }
  return reasons.length > 0 ? reasons.join(",") : null;
}
