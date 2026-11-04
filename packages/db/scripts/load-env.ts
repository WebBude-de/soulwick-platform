import path from "node:path";
import { config as loadEnv } from "dotenv";

/** Same lookup as prisma.config.ts: the root .env.local; variables already set win. */
export function loadDatabaseEnv(): void {
  loadEnv({
    path: path.resolve(import.meta.dirname, "../../../.env.local"),
    quiet: true,
  });
}
