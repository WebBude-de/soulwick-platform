import path from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Same lookup as prisma.config.ts: an optional packages/db/.env first, then apps/api/.env
 * (there is no root .env in this repo). Variables already set in the environment win.
 */
export function loadDatabaseEnv(): void {
  loadEnv({
    path: [
      path.resolve(import.meta.dirname, "../.env"),
      path.resolve(import.meta.dirname, "../../../apps/api/.env"),
    ],
    quiet: true,
  });
}
