import {
  createLogOutput,
  createLogger as createSharedLogger,
  type Logger,
  type LogOutput,
  type LogThreshold,
  resolveLogSettings,
  setLogOutput,
} from "@soulwick/logger";
import type { Config } from "./config.ts";

export type { Logger } from "@soulwick/logger";

const APP = "relay";

/**
 * Console (pretty or JSON) and, outside production, daily files in logs/relay/ (@soulwick/logger).
 * Called once by src/index.ts; tests inject their own logger.
 */
export function initLogging(
  config: Pick<
    Config,
    "NODE_ENV" | "LOG_FORMAT" | "LOG_DIR" | "LOG_RETENTION_DAYS"
  >
): LogOutput {
  const output = createLogOutput({
    app: APP,
    title: "Soulwick Relay",
    settings: resolveLogSettings({
      nodeEnv: config.NODE_ENV,
      format: config.LOG_FORMAT,
      dir: config.LOG_DIR,
      retentionDays: config.LOG_RETENTION_DAYS,
    }),
  });
  setLogOutput(output);
  return output;
}

/**
 * Logger with the LOG_LEVEL threshold. Never pass packet contents or tokens: only ids, room codes,
 * message types, counters and reasons.
 */
export function createLogger(level: LogThreshold): Logger {
  return createSharedLogger({ app: APP, level });
}
