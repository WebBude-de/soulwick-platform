import { createPrisma } from "@soulwick/db";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createLogger, initLogging } from "./lib/logger.ts";
import { startHousekeeping } from "./services/housekeeping.ts";

// Local development: `bun run dev:api` loads the root .env.local (shared values) and
// apps/api/.env.local on top. In Docker/Dokploy the variables are set directly, and the image applies
// pending migrations (`prisma migrate deploy`) before this file starts, see the Dockerfile.
const config = loadConfig();
// Console plus (outside production) logs/api/<day>/; buffered lines are written out on exit.
const logOutput = initLogging(config);
process.on("exit", () => logOutput.close());
const logger = createLogger(config.LOG_LEVEL);
const db = createPrisma(config.DATABASE_URL);

const app = createApp({ db, config });
// Bun passes the server as the second fetch argument; Hono exposes it as c.env (see lib/client-ip.ts).
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
// The pretty console turns this line into the start block (▲ Soulwick API, Local, Logs, ✓ Ready).
logger.info("listening", {
  port: server.port,
  url: `http://localhost:${server.port}`,
  logDir: logOutput.appDir ?? undefined,
  readyMs: Math.round(performance.now()),
});

// Automatic deletions (bug reports past their retention, P-033): once now, then daily.
const stopHousekeeping = startHousekeeping({
  db,
  config,
  logger,
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, close the pool.
const shutdown = (signal: NodeJS.Signals) => {
  logger.info("signal", { signal });
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
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
