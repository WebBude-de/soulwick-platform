import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { loadDatabaseEnv } from "./load-env.ts";
import {
  diffAgainstSchema,
  missingHandWrittenIndexes,
  PACKAGE_DIR,
} from "./schema-diff.ts";

/**
 * Reports the state of the database behind DATABASE_URL and what it takes for the migrations to
 * apply again (ported from DapItUp / WebBude). Read-only: it proposes commands, it changes nothing.
 *
 *   bun run db:status
 *   DATABASE_URL="postgresql://..." bun run db:status   # against another database
 */

loadDatabaseEnv();

const MIGRATIONS_DIR = join(PACKAGE_DIR, "prisma/migrations");

interface RecordedMigration {
  finished_at: Date | null;
  migration_name: string;
  rolled_back_at: Date | null;
}

interface History {
  /** Recorded, but never succeeded. */
  failed: string[];
  /** In the repo, but never applied. */
  missing: string[];
  /** Migrations with at least one clean run. */
  succeeded: Set<string>;
  /** Recorded in the database, absent from the repo. */
  unknown: string[];
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, "migration.sql")))
    .sort();
}

function summarise(recorded: RecordedMigration[], known: string[]): History {
  // A migration can have several rows (a rolled-back attempt next to the run that
  // worked). What counts is whether a name has at least one clean run.
  const succeeded = new Set(
    recorded
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name)
  );
  const names = [...new Set(recorded.map((row) => row.migration_name))];
  return {
    failed: names.filter((name) => !succeeded.has(name)),
    missing: known.filter((name) => !succeeded.has(name)),
    succeeded,
    unknown: names.filter((name) => !known.includes(name)),
  };
}

function reportHistory(history: History, known: string[]): void {
  console.log(
    `Migration history: ${history.succeeded.size} of ${known.length} applied`
  );
  const sections: [string, string[]][] = [
    ["  Not recorded:", history.missing],
    ["  In the database, not in the repo:", history.unknown],
    ["  Failed without a later success:", history.failed],
  ];
  for (const [title, names] of sections) {
    if (names.length > 0) {
      console.log(title);
      for (const name of names) {
        console.log(`    ${name}`);
      }
    }
  }
}

function recommend(options: {
  tableCount: number;
  hasHistory: boolean;
  history: History;
  known: string[];
  inSync: boolean;
}): void {
  const { tableCount, hasHistory, history, known, inSync } = options;
  console.log("\nRecommendation:");

  if (tableCount === 0) {
    console.log("  Empty database. Build it:");
    console.log("    bun run db:deploy");
    console.log("    bun run db:seed:dev");
    return;
  }
  if (!(hasHistory || inSync)) {
    console.log(
      "  Tables without history that do not match schema.prisma (e.g. the old Drizzle layout).\n" +
        "  Rebuild the database (drops all its data!), then seed it again:\n" +
        "    bun run db:reset\n" +
        "    bun run db:seed:dev"
    );
    return;
  }
  if (!hasHistory) {
    console.log(
      "  Tables without history: the database was created with db push or by hand.\n" +
        "  Mark the migrations it already contains as applied, then deploy the rest:\n"
    );
    for (const name of known) {
      console.log(
        `    bunx prisma migrate resolve --applied ${name}   (in packages/db)`
      );
    }
    return;
  }
  if (history.failed.length > 0) {
    console.log(
      "  Resolve the failed migration first (in packages/db):\n" +
        `    bunx prisma migrate resolve --rolled-back ${history.failed[0]}`
    );
    return;
  }
  if (history.missing.length === 0) {
    console.log("  Nothing to do, the history is complete.");
    if (!inSync) {
      console.log(
        "\n  Warning: the database still differs from schema.prisma. Someone changed it\n" +
          "  past the migrations. Create a migration for the difference and run `bun run db:verify`."
      );
    }
    return;
  }
  console.log("  Apply the missing migrations:");
  console.log("    bun run db:deploy");
  console.log(`\n  This applies: ${history.missing.join(", ")}.`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set (root .env.local or packages/db/.env.local)."
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const parsed = new URL(url);
  console.log(`Database: ${parsed.pathname.slice(1)} on ${parsed.host}\n`);

  const { rows: tableRows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const present = new Set(tableRows.map((row) => row.table_name));
  const hasHistory = present.has("_prisma_migrations");
  const tableCount = [...present].filter(
    (name) => name !== "_prisma_migrations"
  ).length;
  console.log(`Tables: ${tableCount}`);

  const known = migrationNames();
  const recorded = hasHistory
    ? (
        await client.query<RecordedMigration>(
          `SELECT migration_name, finished_at, rolled_back_at
           FROM "_prisma_migrations" ORDER BY started_at`
        )
      ).rows
    : [];
  const history = summarise(recorded, known);

  if (hasHistory) {
    reportHistory(history, known);
  } else {
    console.log("Migration history: none (_prisma_migrations missing)");
  }

  const diff = diffAgainstSchema(url);
  const inSync = diff.status === "same";
  console.log(
    `\nState vs. schema.prisma: ${diff.status === "failed" ? "unknown (prisma migrate diff failed)" : inSync ? "in sync" : "differs"}`
  );
  if (tableCount > 0) {
    const missing = await missingHandWrittenIndexes(client);
    console.log(
      `Hand-written indexes: ${missing.length === 0 ? "present" : `missing ${missing.join(", ")}`}`
    );
  }

  recommend({ hasHistory, history, inSync, known, tableCount });
  await client.end();
}

main().catch((error) => {
  console.error("Could not read the status:", error);
  process.exitCode = 1;
});
