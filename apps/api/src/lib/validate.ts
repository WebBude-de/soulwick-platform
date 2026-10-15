import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, withCause } from "./errors.ts";

function fail(error: z.ZodError, where: string): never {
  throw new ApiError(400, "validation_error", `Invalid ${where}`, {
    details: error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  });
}

function validateBody<T extends z.ZodType>(
  raw: unknown,
  schema: T
): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    fail(result.error, "request body");
  }
  return result.data;
}

const invalidJson = (err: unknown) =>
  withCause(
    new ApiError(400, "invalid_json", "Request body must be valid JSON"),
    err
  );

export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch (err) {
    throw invalidJson(err);
  }
  return validateBody(raw, schema);
}

/** Like `parseBody`, but an empty body counts as `{}` (e.g. DELETE with optional options). */
export async function parseOptionalBody<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.output<T>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw invalidJson(err);
    }
  }
  return validateBody(raw, schema);
}

export function parseQuery<T extends z.ZodType>(
  c: Context,
  schema: T
): z.output<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    fail(result.error, "query");
  }
  return result.data;
}

export function parseParam<T extends z.ZodType>(
  c: Context,
  name: string,
  schema: T
): z.output<T> {
  const result = schema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ApiError(404, "not_found", `Invalid ${name}`);
  }
  return result.data;
}

export const iso = (d: Date | string): string => new Date(d).toISOString();
export const isoOrNull = (
  d: Date | string | null | undefined
): string | null => (d === null || d === undefined ? null : iso(d));
