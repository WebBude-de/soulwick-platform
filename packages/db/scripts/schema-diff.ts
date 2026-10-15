import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Client } from "pg";

export const PACKAGE_DIR = resolve(import.meta.dir, "..");

/**
 * Indexes that exist only as hand-written SQL in the init migration: Prisma can express neither
 * partial nor expression indexes, and `prisma migrate diff` silently ignores them in both
 * directions. The diff step therefore cannot notice when a later migration drops them, so
 * db:verify and db:status check for them explicitly (see the Guild model in schema.prisma).
 */
export const HAND_WRITTEN_INDEXES: {
  name: string;
  table: string;
  mustContain: string;
}[] = [
  {
    name: "guilds_name_active_uq",
    table: "guilds",
    mustContain: "WHERE (disbanded_at IS NULL)",
  },
  {
    name: "guilds_tag_active_uq",
    table: "guilds",
    mustContain: "WHERE (disbanded_at IS NULL)",
  },
];

export interface SchemaDiff {
  script: string;
  /** same = database matches schema.prisma, differs = the script is what is missing. */
  status: "same" | "differs" | "failed";
  stderr: string;
}

/** `prisma migrate diff` from the database behind `url` to schema.prisma. */
export function diffAgainstSchema(url: string): SchemaDiff {
  // One command string: node deprecated argv + shell (DEP0190); Windows needs the shell.
  const result = spawnSync(
    "bunx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code",
    {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url },
      shell: true,
    }
  );
  // 0 = no difference, 2 = there is one, anything else = the CLI failed.
  const status =
    result.status === 0 ? "same" : result.status === 2 ? "differs" : "failed";
  return { status, script: result.stdout, stderr: result.stderr };
}

/** Names of the hand-written indexes that are missing (or lost their predicate) in the database. */
export async function missingHandWrittenIndexes(
  client: Client
): Promise<string[]> {
  const { rows } = await client.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1)`,
    [HAND_WRITTEN_INDEXES.map((index) => index.name)]
  );
  return HAND_WRITTEN_INDEXES.filter((index) => {
    const row = rows.find((r) => r.indexname === index.name);
    return !row?.indexdef.includes(index.mustContain);
  }).map((index) => index.name);
}
