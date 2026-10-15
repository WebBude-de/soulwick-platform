import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdminRole, AuthResponse } from "@soulwick/contracts";
import { createPrisma } from "@soulwick/db";
import pg from "pg";
import { createApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import { createAdminAccount } from "../src/services/admin-users.ts";
import type { BaseDeps } from "../src/types.ts";

export const DEV_KEY = "test-dev-auth-key-0123456789";
const LINE_BREAK = /\r?\n/;
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../packages/db/prisma/migrations", import.meta.url)
);
/** Local env files, later ones win (same order as `bun run dev:api`). */
const ENV_FILES = [
  fileURLToPath(new URL("../../../.env.local", import.meta.url)),
  fileURLToPath(new URL("../.env.local", import.meta.url)),
];

/** Minimal KEY=VALUE reader: `bun test` runs from the repo root, where Bun loads no .env file. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(LINE_BREAK)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/**
 * Postgres server for the throwaway test databases (P-011): TEST_DATABASE_URL, else DATABASE_URL,
 * each from the environment first and then from the root .env.local and apps/api/.env.local. The database named in the URL is
 * only used for the admin connection that creates and drops `soulwick_test_<random>`.
 */
function baseDatabaseUrl(): string {
  const fileVars = Object.assign({}, ...ENV_FILES.map(readEnvFile)) as Record<
    string,
    string
  >;
  const url =
    process.env.TEST_DATABASE_URL ??
    fileVars.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    fileVars.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Tests need the local Postgres: run `bun run services:up` and set DATABASE_URL in the root .env.local (or TEST_DATABASE_URL)."
    );
  }
  return url;
}

function withDatabase(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withAdmin<T>(
  base: string,
  run: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({ connectionString: base });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Applies the committed migration files in order: same result as `prisma migrate deploy`, without the CLI. */
async function applyMigrations(client: pg.Client): Promise<void> {
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((dir) => existsSync(join(MIGRATIONS_DIR, dir, "migration.sql")))
    .sort();
  for (const dir of dirs) {
    await client.query(
      readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8")
    );
  }
}

export const testConfig = (overrides: Record<string, string> = {}): Config =>
  loadConfig({
    NODE_ENV: "test",
    BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:8787",
    DEV_AUTH_ENABLED: "true",
    DEV_AUTH_KEY: DEV_KEY,
    RATE_LIMIT_PER_MINUTE: "100000",
    LINK_ATTEMPTS_PER_MINUTE: "100000",
    DELETION_REQUESTS_PER_HOUR: "100000",
    GUEST_LOGINS_PER_MINUTE: "100000",
    GUEST_ACCOUNTS_PER_HOUR: "100000",
    KNOWN_GAME_VERSIONS: "0.9.0,1.0.0",
    MIN_SECONDS_PER_ROOM: "8",
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
    ...overrides,
  });

interface ReqOpts {
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
}

/**
 * Fresh database `soulwick_test_<random>` on the local Postgres with all migrations applied, a
 * Prisma client on it and the app on top. `close()` drops the database again. `deps` injects a
 * fake `fetch` (Steam, Google, eRecht24) or clock.
 */
export async function createTestContext(
  configOverrides: Record<string, string> = {},
  deps: Pick<BaseDeps, "fetch" | "now"> = {}
) {
  const base = baseDatabaseUrl();
  const dbName = `soulwick_test_${randomBytes(4).toString("hex")}`;
  await withAdmin(base, (admin) => admin.query(`create database ${dbName}`));
  const url = withDatabase(base, dbName);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await applyMigrations(client);
  const db = createPrisma(url, { max: 4 });
  const config = testConfig(configOverrides);
  const app = createApp({ db, config, ...deps });

  async function req(method: string, path: string, opts: ReqOpts = {}) {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) {
      headers.authorization = `Bearer ${opts.token}`;
    }
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const res = await app.request(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const json: any = text ? JSON.parse(text) : null;
    return { status: res.status, json };
  }

  async function login(name = `P${randomUUID().slice(0, 8)}`) {
    const res = await req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name, deviceId: randomUUID() },
    });
    if (res.status !== 200) {
      throw new Error(
        `login failed: ${res.status} ${JSON.stringify(res.json)}`
      );
    }
    const auth = res.json as AuthResponse;
    return { token: auth.token, id: auth.player.id, name };
  }

  async function createAdmin(role: AdminRole = "admin") {
    const email = `${role}-${randomUUID().slice(0, 8)}@example.com`;
    const password = "correct-horse-battery";
    const row = await createAdminAccount(db, { email, password, role });
    const res = await req("POST", "/admin/auth/login", {
      body: { email, password },
    });
    if (res.status !== 200) {
      throw new Error(`admin login failed: ${res.status}`);
    }
    return { id: row.id, email, password, token: res.json.token as string };
  }

  function reportRun(
    token: string,
    body: Partial<{
      mode: string;
      guildId: string;
      participants: string[];
      roomReached: number;
      durationSeconds: number;
      seed: string;
      gameVersion: string;
    }>
  ) {
    return req("POST", "/runs", {
      token,
      body: {
        mode: "solo",
        roomReached: 10,
        durationSeconds: 600,
        seed: "abc",
        gameVersion: "1.0.0",
        ...body,
      },
    });
  }

  async function close() {
    await db.$disconnect();
    await client.end();
    await withAdmin(base, (admin) =>
      admin.query(`drop database if exists ${dbName} with (force)`)
    );
  }

  return {
    app,
    db,
    /** Connection string of the test database (for scripts started as a subprocess). */
    databaseUrl: url,
    /** node-postgres client on the test database, for raw checks. */
    client,
    config,
    req,
    login,
    createAdmin,
    reportRun,
    close,
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
