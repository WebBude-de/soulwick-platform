import type { Config } from "../config.ts";
import type { Logger } from "../lib/logger.ts";
import { deleteExpiredBugReports } from "./bug-reports.ts";
import type { Db } from "./db-types.ts";
import { deleteOldNameChanges } from "./profile.ts";

/** How often the cleanup runs after the one at start-up. */
export const HOUSEKEEPING_INTERVAL_MS = 24 * 3_600_000;

/**
 * One cleanup pass: deletes bug reports past BUG_REPORT_RETENTION_DAYS (P-033) and name changes
 * past NAME_HISTORY_RETENTION_DAYS (P-034). Errors are logged,
 * never thrown, so a database hiccup does not stop the API; the next pass catches up.
 */
export async function runHousekeeping(deps: {
  db: Db;
  config: Config;
  logger: Logger;
  now?: () => Date;
}): Promise<{ bugReports: number; nameChanges: number } | null> {
  const now = deps.now?.() ?? new Date();
  try {
    const bugReports = await deleteExpiredBugReports(
      deps.db,
      now,
      deps.config.BUG_REPORT_RETENTION_DAYS
    );
    const nameChanges = await deleteOldNameChanges(deps.db, now);
    if (bugReports > 0 || nameChanges > 0) {
      deps.logger.info("housekeeping", {
        deletedBugReports: bugReports,
        deletedNameChanges: nameChanges,
      });
    }
    return { bugReports, nameChanges };
  } catch (err) {
    deps.logger.error("housekeeping_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Runs the cleanup once at start-up and then every HOUSEKEEPING_INTERVAL_MS in this process. The API
 * runs as exactly one replica (in-memory rate limits), so no lock is needed; with several replicas
 * the deletes would only run twice, which is harmless. Returns a stop function.
 */
export function startHousekeeping(deps: {
  db: Db;
  config: Config;
  logger: Logger;
}): () => void {
  runHousekeeping(deps).catch(() => undefined);
  const timer = setInterval(() => {
    runHousekeeping(deps).catch(() => undefined);
  }, HOUSEKEEPING_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
