import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { loadDatabaseEnv } from "./load-env.ts";
import {
  diffAgainstSchema,
  HAND_WRITTEN_INDEXES,
  missingHandWrittenIndexes,
  PACKAGE_DIR,
} from "./schema-diff.ts";

/**
 * Proves that the migrations can build a database from nothing (ported from DapItUp / WebBude).
 *
 * Why: a database that grew through `prisma db push` can look right while the migration
 * history has gaps that only surface on the first fresh deploy. This script catches that
 * before a push (see .husky/pre-push).
 *
 * Checks, in this order:
 * 1. Build: a throwaway database is created and every migration applied in order.
 * 2. Hand-written SQL: the partial indexes Prisma cannot express must exist afterwards
 *    (`prisma migrate diff` ignores them, so a migration that dropped them would pass unnoticed).
 * 3. Agreement: `prisma migrate diff` compares the result with schema.prisma; the
 *    difference has to be empty.
 * 4. Data: an optional `fixture.sql` next to a migration runs before it, an `assert.sql`
 *    after it (must return exactly one row with `ok = true`), then `cleanup.sql`.
 * 5. Seed: the dev seed runs against the fresh database (skip with `--no-seed`).
 *
 * The throwaway database lives on the same server as DATABASE_URL and is always dropped.
 * The real database is never touched.
 *
 *   bun run db:verify
 */

loadDatabaseEnv();

const MIGRATIONS_DIR = join(PACKAGE_DIR, "prisma/migrations");
const SEED_FILE = resolve(
  PACKAGE_DIR,
  "../../apps/api/src/scripts/seed-dev.ts"
);
const SHADOW_DB = `soulwick_verify_${process.pid}`;
const skipSeed = process.argv.includes("--no-seed");

function fail(message: string): never {
  console.error(`\nFAIL ${message}`);
  process.exit(1);
}

function shadowUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `/${SHADOW_DB}`;
  return url.toString();
}

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();
}

async function withClient<T>(
  url: string,
  run: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** An optional file next to a migration, e.g. fixture.sql. */
function companion(dir: string, file: string): string | null {
  const path = join(MIGRATIONS_DIR, dir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

async function runFixture(client: Client, dir: string): Promise<boolean> {
  const fixture = companion(dir, "fixture.sql");
  if (!fixture) {
    return false;
  }
  try {
    await client.query(fixture);
  } catch (error) {
    fail(`fixture.sql of ${dir} failed:\n  ${error}`);
  }
  return true;
}

async function runMigration(client: Client, dir: string): Promise<void> {
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    fail(
      `Migration ${dir} failed:\n  ${error}\n\nA fresh deploy would stop at the same point.`
    );
  }
}

async function runAssertion(client: Client, dir: string): Promise<boolean> {
  const assertion = companion(dir, "assert.sql");
  if (!assertion) {
    return false;
  }
  let rows: { ok?: unknown }[] = [];
  try {
    rows = (await client.query(assertion)).rows as { ok?: unknown }[];
  } catch (error) {
    fail(`assert.sql of ${dir} failed:\n  ${error}`);
  }
  if (rows.length !== 1 || rows[0]?.ok !== true) {
    fail(
      `assert.sql of ${dir} was not met.\n  Result: ${JSON.stringify(rows)}`
    );
  }
  const cleanup = companion(dir, "cleanup.sql");
  if (cleanup) {
    await client.query(cleanup);
  }
  return true;
}

async function applyMigrations(url: string): Promise<number> {
  let asserts = 0;
  await withClient(url, async (client) => {
    for (const dir of migrationDirs()) {
      const hadFixture = await runFixture(client, dir);
      await runMigration(client, dir);
      const checked = await runAssertion(client, dir);
      if (checked) {
        asserts += 1;
      }
      const notes = [
        hadFixture ? "with fixture" : null,
        checked ? "asserted" : null,
      ].filter(Boolean);
      console.log(
        `  ok ${dir}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`
      );
    }
    const missing = await missingHandWrittenIndexes(client);
    if (missing.length > 0) {
      fail(
        `Hand-written indexes missing after the migrations: ${missing.join(", ")}.\n` +
          "  A later migration must not drop them (see packages/db/scripts/schema-diff.ts)."
      );
    }
    console.log(
      `  ok hand-written indexes present (${HAND_WRITTEN_INDEXES.map((i) => i.name).join(", ")})`
    );
  });
  return asserts;
}

function runSeed(url: string): void {
  const result = spawnSync(`bun "${SEED_FILE}"`, {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url },
    shell: true,
  });
  if (result.status !== 0) {
    fail(
      `The dev seed does not run against a freshly migrated database:\n${result.stdout}\n${result.stderr}`
    );
  }
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) {
    fail(
      "DATABASE_URL is not set (root .env.local or packages/db/.env.local)."
    );
  }
  const url = shadowUrl(base);
  const dirs = migrationDirs();
  console.log(
    `Checking ${dirs.length} migration(s) against an empty database.\n`
  );

  await withClient(base, async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${SHADOW_DB}`);
    await admin.query(`CREATE DATABASE ${SHADOW_DB}`);
  });

  try {
    const asserts = await applyMigrations(url);

    const diff = diffAgainstSchema(url);
    if (diff.status === "failed") {
      fail(`prisma migrate diff failed:\n${diff.stderr}`);
    }
    if (diff.status === "differs") {
      console.error(
        "\nFAIL The migrations do not produce the state of schema.prisma.\n  Missing to match:\n"
      );
      console.error(diff.script);
      fail("Schema and migrations drift apart.");
    }
    console.log("\n  ok result matches schema.prisma");

    if (skipSeed) {
      console.log("  -- seed skipped (--no-seed)");
    } else {
      runSeed(url);
      console.log("  ok dev seed runs against the fresh state");
    }

    console.log(
      `\nOK Migrations are complete. ${dirs.length} applied, ${asserts} data check(s).`
    );
  } finally {
    await withClient(base, (admin) =>
      admin.query(`DROP DATABASE IF EXISTS ${SHADOW_DB} WITH (FORCE)`)
    );
  }
}

main().catch((error) => {
  console.error("FAIL Check aborted:", error);
  process.exitCode = 1;
});
