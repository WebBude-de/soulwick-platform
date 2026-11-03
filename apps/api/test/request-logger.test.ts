import { describe, expect, it } from "bun:test";
import type { Logger } from "@soulwick/logger";
import { Hono } from "hono";
import { ApiError, createErrorHandler } from "../src/lib/errors.ts";
import { requestLogger } from "../src/lib/logger.ts";

function capturingLogger() {
  const lines: {
    level: string;
    msg: string;
    fields: Record<string, unknown>;
  }[] = [];
  const at =
    (level: string) =>
    (msg: string, fields: Record<string, unknown> = {}) =>
      lines.push({ level, msg, fields });
  const logger: Logger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
  return { lines, logger };
}

function app(logger: Logger) {
  const a = new Hono();
  a.onError(createErrorHandler(logger));
  a.use("*", requestLogger(logger, false));
  a.get("/ok", (c) => c.json({ ok: true }));
  a.get("/forbidden", () => {
    throw new ApiError(403, "forbidden", "Not allowed");
  });
  a.get("/boom", () => {
    throw new Error("database gone");
  });
  return a;
}

describe("requestLogger", () => {
  it("logs 2xx as info, 4xx as warn with the error code, 5xx as error", async () => {
    const { lines, logger } = capturingLogger();
    const a = app(logger);
    await a.request("/ok");
    await a.request("/forbidden");
    await a.request("/boom");
    await a.request("/missing");
    const requests = lines.filter((l) => l.msg === "request");
    expect(
      requests.map((l) => [
        l.level,
        l.fields.path,
        l.fields.status,
        l.fields.code,
      ])
    ).toEqual([
      ["info", "/ok", 200, undefined],
      ["warn", "/forbidden", 403, "forbidden"],
      ["error", "/boom", 500, undefined],
      ["warn", "/missing", 404, undefined],
    ]);
    // The unhandled error itself is logged once with its stack, never sent to the client.
    const unhandled = lines.filter((l) => l.msg === "unhandled_error");
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0]?.level).toBe("error");
    expect(String(unhandled[0]?.fields.stack)).toContain("database gone");
  });
});
