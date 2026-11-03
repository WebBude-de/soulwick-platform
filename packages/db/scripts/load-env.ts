import path from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Same lookup as prisma.config.ts: an optional packages/db/.env first, then the root
 * .env (shared values). Variables already set in the environment win.
 */
export function loadDatabaseEnv(): void {
  loadEnv({
    path: [
      path.resolve(import.meta.dirname, "../.env"),
      path.resolve(import.meta.dirname, "../../../.env"),
    ],
    quiet: true,
  });
}
