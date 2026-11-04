import path from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Same lookup as prisma.config.ts: an optional packages/db/.env.local first, then the root
 * .env.local (shared values). Variables already set in the environment win.
 */
export function loadDatabaseEnv(): void {
  loadEnv({
    path: [
      path.resolve(import.meta.dirname, "../.env.local"),
      path.resolve(import.meta.dirname, "../../../.env.local"),
    ],
    quiet: true,
  });
}
