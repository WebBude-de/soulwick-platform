import type { MiddlewareHandler } from "hono";
import { clientIp } from "./client-ip.ts";

export interface Logger {
  error: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
}

/** JSON lines on stdout/stderr – easy to read in `docker logs` and Dokploy. */
export function createLogger(level: "info" | "error" | "silent"): Logger {
  const write = (
    stream: NodeJS.WriteStream,
    lvl: string,
    msg: string,
    fields?: Record<string, unknown>
  ) =>
    stream.write(
      `${JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields })}\n`
    );
  return {
    info: (msg, fields) => {
      if (level === "info") {
        write(process.stdout, "info", msg, fields);
      }
    },
    error: (msg, fields) => {
      if (level !== "silent") {
        write(process.stderr, "error", msg, fields);
      }
    },
  };
}

export function requestLogger(
  logger: Logger,
  trustProxy: boolean
): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    logger.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      ip: clientIp(c, trustProxy),
    });
  };
}
