import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// DATABASE_URL is a shared value in the root .env.local. An optional packages/db/.env.local wins
// over it (e.g. to point the Prisma CLI at another database); dotenv keeps the first value it sees.
// scripts/load-env.ts uses the same lookup.
loadEnv({
  path: [
    path.resolve(import.meta.dirname, ".env.local"),
    path.resolve(import.meta.dirname, "../../.env.local"),
  ],
  quiet: true,
});

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    // `prisma migrate reset` and `prisma db seed` run the dev seed (it refuses NODE_ENV=production).
    seed: "bun run --cwd ../../apps/api seed:dev",
  },
  schema: "prisma/schema.prisma",
});
