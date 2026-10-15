import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { startRelayServer } from "./server.ts";

// Local development: `bun run dev:relay` loads the root .env.local (shared values) and
// apps/relay/.env.local on top. In Docker/Dokploy the variables are set directly.
const config = loadConfig(process.env, process.argv.slice(2));
const logger = createLogger(config.LOG_LEVEL);
const relay = startRelayServer(config, { logger });

logger.info("listening", {
  port: relay.port,
  protocolVersion: config.PROTOCOL_VERSION,
  clientRouting: config.CLIENT_ROUTING,
  api: config.API_INTERNAL_URL || undefined,
  simLatencyMs: config.RELAY_SIM_LATENCY_MS || undefined,
  simLossPercent: config.RELAY_SIM_LOSS || undefined,
});

// Graceful shutdown: rooms get `room_closed` (shutdown), sockets close with 1001.
let stopping = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (stopping) {
    return;
  }
  stopping = true;
  // A deploy restarts the relay: this line in the container log dates the end of every room.
  logger.info("signal", { signal, ...relay.relay.stats() });
  setTimeout(() => process.exit(1), 10_000).unref();
  relay.stop().then(
    () => process.exit(0),
    () => process.exit(1)
  );
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
