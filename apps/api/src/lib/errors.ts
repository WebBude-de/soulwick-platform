import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "./logger.ts";

/** Throw anywhere in a handler; rendered as `{ error, message?, ...extra }` with the given status. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly extra: Record<string, unknown> | undefined;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message?: string,
    extra?: Record<string, unknown>
  ) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * For catch blocks that translate a caught error into a new one: keeps the original as `cause`
 * (visible in logs and debuggers, never sent to clients).
 */
export function withCause<E extends Error>(error: E, cause: unknown): E {
  error.cause = cause;
  return error;
}

export const notFound = (what: string) =>
  new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (message = "Not allowed") =>
  new ApiError(403, "forbidden", message);

export function createErrorHandler(logger: Logger) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) {
      return c.json(
        {
          error: err.code,
          ...(err.message === err.code ? {} : { message: err.message }),
          ...err.extra,
        },
        err.status
      );
    }
    if (err instanceof HTTPException) {
      return c.json({ error: "http_error", message: err.message }, err.status);
    }
    logger.error("unhandled_error", {
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      cause: err.cause instanceof Error ? err.cause.message : undefined,
      stack: err.stack,
    });
    return c.json(
      { error: "internal_error", message: "Internal server error" },
      500
    );
  };
}

/**
 * Postgres unique violation as Prisma reports it (P2002 for model queries, P2010 with the Postgres
 * code 23505 for raw SQL) or as node-postgres throws it (23505). With `constraint`, the index or
 * column name has to appear in the error details (Prisma lists the fields or the constraint name).
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === "object"; depth += 1) {
    const rec = e as {
      code?: unknown;
      meta?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const meta = (rec.meta ?? {}) as { code?: unknown };
    const unique =
      rec.code === "23505" ||
      rec.code === "P2002" ||
      (rec.code === "P2010" && meta.code === "23505");
    if (unique) {
      if (!constraint) {
        return true;
      }
      const text = JSON.stringify({
        constraint: rec.constraint,
        meta: rec.meta,
        message: rec.message,
      });
      return text.includes(constraint);
    }
    e = rec.cause;
  }
  return false;
}

/** Prisma P2025: the record an update/delete targeted does not exist (any more). */
export function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2025"
  );
}
