import type { LogLevel, LogRecord } from "./levels.ts";

/** Keys of the JSON line that fields cannot overwrite. */
const CORE_KEYS = new Set(["time", "level", "app", "msg"]);
/** Strings that can stay unquoted in `key=value`. */
const BARE_VALUE = /^[\w.:/@+-]+$/;
export const NEWLINES = /\r?\n/;

export const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  magenta: "\u001b[35m",
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.magenta,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
};

/** Errors as plain objects (JSON.stringify drops their fields), bigints as strings. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: value.cause }),
    };
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, jsonReplacer) ?? "null";
  } catch {
    return '"[unserializable]"';
  }
}

/** One JSON object without trailing newline: `{"time","level","app","msg",...fields}`. */
export function formatJson(record: LogRecord): string {
  const out: Record<string, unknown> = {
    time: record.time.toISOString(),
    level: record.level,
    app: record.app,
    msg: record.msg,
  };
  for (const [key, value] of Object.entries(record.fields)) {
    if (!CORE_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return safeJson(out);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local wall-clock time `HH:MM:SS.mmm`. */
export function clock(time: Date): string {
  const ms = String(time.getMilliseconds()).padStart(3, "0");
  return `${pad2(time.getHours())}:${pad2(time.getMinutes())}:${pad2(time.getSeconds())}.${ms}`;
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return BARE_VALUE.test(value) ? value : JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return JSON.stringify(value.message);
  }
  return safeJson(value);
}

export interface Stack {
  key: string;
  text: string;
}

/**
 * Stack traces (a `stack` string field, Error values) and multi-line strings go below the line
 * instead of inline.
 */
export function splitStacks(fields: Record<string, unknown>): {
  inline: [string, unknown][];
  stacks: Stack[];
} {
  const inline: [string, unknown][] = [];
  const stacks: Stack[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (key === "stack" && typeof value === "string") {
      stacks.push({ key, text: value });
      continue;
    }
    if (value instanceof Error && value.stack) {
      stacks.push({ key, text: value.stack });
    }
    if (typeof value === "string" && NEWLINES.test(value.trim())) {
      // Multi-line messages (Prisma errors): first line inline, the full text below.
      const first = value.trim().split(NEWLINES)[0] ?? "";
      stacks.push({ key, text: value.trim() });
      inline.push([key, `${first} …`]);
      continue;
    }
    inline.push([key, value]);
  }
  return { inline, stacks };
}

/** Request lines read like an access log: `GET /admin/me 200 3ms`. */
function requestSummary(fields: Record<string, unknown>): string | null {
  const { method, path, status, ms } = fields;
  if (typeof method !== "string" || typeof path !== "string") {
    return null;
  }
  const parts = [method, path];
  if (typeof status === "number") {
    parts.push(String(status));
  }
  if (typeof ms === "number") {
    parts.push(`${ms}ms`);
  }
  return parts.join(" ");
}

const REQUEST_KEYS = new Set(["method", "path", "status", "ms"]);

/**
 * One readable line (plus indented stack lines):
 * `12:34:56.789 INFO  api  request  GET /admin/me 200 3ms ip=::1`.
 */
export function formatPretty(
  record: LogRecord,
  opts: { color: boolean }
): string {
  const paint = (code: string, text: string) =>
    opts.color ? `${code}${text}${ANSI.reset}` : text;
  const { inline, stacks } = splitStacks(record.fields);
  const summary = requestSummary(record.fields);
  const pairs = inline
    .filter(([key]) => !(summary && REQUEST_KEYS.has(key)))
    .map(
      ([key, value]) => `${paint(ANSI.dim, `${key}=`)}${formatValue(value)}`
    );
  const rest = [summary, ...pairs].filter(Boolean).join(" ");
  const level = paint(
    LEVEL_COLOR[record.level],
    record.level.toUpperCase().padEnd(5)
  );
  let line = `${paint(ANSI.dim, clock(record.time))} ${level} ${record.app}  ${paint(ANSI.bold, record.msg)}`;
  if (rest) {
    line += `  ${rest}`;
  }
  for (const stack of stacks) {
    const indented = stack.text
      .split(NEWLINES)
      .map((l) => (l.trim() ? `    ${l}` : ""))
      .join("\n");
    line += `\n${paint(ANSI.dim, indented)}`;
  }
  return line;
}
