import { createPrisma } from "@soulwick/db";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { startHousekeeping } from "./services/housekeeping.ts";

// Local development: `bun run dev:api` loads the root .env.local (shared values) and
// apps/api/.env.local on top. In Docker/Dokploy the variables are set directly, and the image applies
// pending migrations (`prisma migrate deploy`) before this file starts, see the Dockerfile.
const config = loadConfig();
const db = createPrisma(config.DATABASE_URL);

const app = createApp({ db, config });
// Bun passes the server as the second fetch argument; Hono exposes it as c.env (see lib/client-ip.ts).
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
console.log(
  JSON.stringify({
    time: new Date().toISOString(),
    level: "info",
    msg: "listening",
    port: server.port,
  })
);

// Automatic deletions (bug reports past their retention, P-033): once now, then daily.
const stopHousekeeping = startHousekeeping({
  db,
  config,
  logger: createLogger(config.LOG_LEVEL),
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, close the pool.
const shutdown = () => {
  setTimeout(() => process.exit(1), 10_000).unref();
  stopHousekeeping();
  server
    .stop()
    .then(() => db.$disconnect())
    .then(
      () => process.exit(0),
      () => process.exit(1)
    );
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
