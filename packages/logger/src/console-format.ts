import { isAbsolute, relative } from "node:path";
import {
  ANSI,
  clock,
  formatValue,
  NEWLINES,
  type Stack,
  splitStacks,
} from "./format.ts";
import type { LogLevel, LogRecord } from "./levels.ts";

export interface ConsoleFormatOptions {
  color: boolean;
  /** Repository root: the `Logs:` line shows the log folder relative to it. */
  repoRoot: string;
  /** Name in the start block, e.g. `Soulwick API`. */
  title: string;
}

/** Width of `HH:MM:SS.mmm` plus the space: follow-up lines start under the symbol. */
const INDENT = " ".repeat(13);

const SYMBOL: Record<LogLevel, string> = {
  debug: "·",
  info: "○",
  warn: "⚠",
  error: "⨯",
};

const SYMBOL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.dim,
  info: "",
  warn: ANSI.yellow,
  error: ANSI.red,
};

/** Fields the start block shows on its own lines. */
const BANNER_KEYS = new Set(["url", "logDir", "readyMs"]);
const REQUEST_KEYS = new Set(["method", "path", "status", "ms"]);

function statusColor(status: number): string {
  if (status >= 500) {
    return ANSI.red;
  }
  if (status >= 400) {
    return ANSI.yellow;
  }
  if (status >= 300) {
    return ANSI.cyan;
  }
  return ANSI.green;
}

function displayDir(dir: string, repoRoot: string): string {
  const rel = relative(repoRoot, dir);
  const shown = rel.startsWith("..") || isAbsolute(rel) ? dir : rel;
  return `${shown}/`;
}

/**
 * Console line in the style of the Next.js dev server, without dropping anything: dimmed time,
 * a symbol per level (· debug, ○ info, ⚠ warn, ⨯ error) instead of the level word, no app name
 * (Turbo prefixes it), all fields dimmed as `key=value`, stacks indented below. Special lines:
 * `listening` becomes the start block (▲ name, Local, Logs, ✓ Ready), `request` reads
 * `GET /path 200 in 3ms` with the status coloured by class, `signal` becomes `○ Stopped (SIGTERM)`.
 */
export function formatConsole(
  record: LogRecord,
  opts: ConsoleFormatOptions
): string {
  const paint = (code: string, text: string) =>
    opts.color && code ? `${code}${text}${ANSI.reset}` : text;
  const time = paint(ANSI.dim, clock(record.time));
  const { inline, stacks } = splitStacks(record.fields);
  const fieldsExcept = (skip: Set<string>) => {
    const pairs = inline
      .filter(([key]) => !skip.has(key))
      .map(([key, value]) => `${key}=${formatValue(value)}`);
    return pairs.length > 0 ? `  ${paint(ANSI.dim, pairs.join(" "))}` : "";
  };
  const symbol = paint(SYMBOL_COLOR[record.level], SYMBOL[record.level]);
  const { fields } = record;

  let lines: string[];
  if (record.msg === "listening") {
    lines = banner(record, opts, paint, time, fieldsExcept);
  } else if (
    record.msg === "request" &&
    typeof fields.method === "string" &&
    typeof fields.path === "string"
  ) {
    const status =
      typeof fields.status === "number"
        ? ` ${paint(statusColor(fields.status), String(fields.status))}`
        : "";
    const ms =
      typeof fields.ms === "number"
        ? paint(ANSI.dim, ` in ${fields.ms}ms`)
        : "";
    const requestSymbol = record.level === "info" ? " " : symbol;
    lines = [
      `${time} ${requestSymbol} ${fields.method} ${fields.path}${status}${ms}${fieldsExcept(REQUEST_KEYS)}`,
    ];
  } else if (record.msg === "signal" && typeof fields.signal === "string") {
    lines = [
      `${time} ${symbol} Stopped (${fields.signal})${fieldsExcept(new Set(["signal"]))}`,
    ];
  } else {
    const text = `${record.msg}${fieldsExcept(new Set())}`;
    lines = [
      record.level === "debug"
        ? `${time} ${paint(ANSI.dim, `${SYMBOL.debug} ${text}`)}`
        : `${time} ${symbol} ${text}`,
    ];
  }
  return [...lines, ...stackLines(stacks, paint)].join("\n");
}

function banner(
  record: LogRecord,
  opts: ConsoleFormatOptions,
  paint: (code: string, text: string) => string,
  time: string,
  fieldsExcept: (skip: Set<string>) => string
): string[] {
  const { url, logDir, readyMs } = record.fields;
  // The port is part of the URL; without a URL it stays a field.
  const skip = new Set(BANNER_KEYS);
  if (typeof url === "string") {
    skip.add("port");
  }
  const lines = [
    `${time} ${paint(ANSI.bold, `▲ ${opts.title}`)}${fieldsExcept(skip)}`,
  ];
  if (typeof url === "string") {
    lines.push(`${INDENT}- Local:  ${url}`);
  }
  if (typeof logDir === "string") {
    lines.push(`${INDENT}- Logs:   ${displayDir(logDir, opts.repoRoot)}`);
  }
  if (typeof readyMs === "number") {
    lines.push(`${time} ${paint(ANSI.green, "✓")} Ready in ${readyMs}ms`);
  }
  return lines;
}

function stackLines(
  stacks: Stack[],
  paint: (code: string, text: string) => string
): string[] {
  return stacks.flatMap((stack) =>
    stack.text
      .split(NEWLINES)
      .map((line) => (line.trim() ? paint(ANSI.dim, `${INDENT}  ${line}`) : ""))
  );
}
