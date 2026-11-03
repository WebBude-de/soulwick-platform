import {
  createLogOutput,
  createLogger as createSharedLogger,
  type Logger,
  type LogOutput,
  type LogThreshold,
  resolveLogSettings,
  setLogOutput,
} from "@soulwick/logger";
import type { MiddlewareHandler } from "hono";
import type { Config } from "../config.ts";
import { clientIp, type ProxyTrust } from "./client-ip.ts";
import { ApiError } from "./errors.ts";

export type { Logger } from "@soulwick/logger";

const APP = "api";

/**
 * Console (pretty or JSON) and, outside production, daily files in logs/api/ (@soulwick/logger).
 * Called once by src/index.ts; until then (tests, scripts) loggers write to the console only.
 */
export function initLogging(
  config: Pick<
    Config,
    "NODE_ENV" | "LOG_FORMAT" | "LOG_DIR" | "LOG_RETENTION_DAYS"
  >
): LogOutput {
  const output = createLogOutput({
    app: APP,
    title: "Soulwick API",
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

/** Logger with the LOG_LEVEL threshold; writes to the output of `initLogging`. */
export function createLogger(level: LogThreshold): Logger {
  return createSharedLogger({ app: APP, level });
}

/** Error code of an ApiError the error handler turned into this response (Hono sets c.error). */
function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

/** One line per request: 2xx/3xx info, 4xx warn (with the error code), 5xx error. */
export function requestLogger(
  logger: Logger,
  trustProxy: ProxyTrust
): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    logger[level]("request", {
      method: c.req.method,
      path: c.req.path,
      status,
      ms: Math.round(performance.now() - start),
      ip: clientIp(c, trustProxy),
      code: status >= 400 ? errorCode(c.error) : undefined,
    });
  };
}
