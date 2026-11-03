import { formatConsole } from "./console-format.ts";
import { formatJson } from "./format.ts";
import type { LogFormat, LogRecord } from "./levels.ts";
import { REPO_ROOT } from "./paths.ts";

/** Where log records go (console, files). `flush` and `close` are synchronous. */
export interface LogSink {
  close: () => void;
  flush: () => void;
  write: (record: LogRecord) => void;
}

/** The part of a Node/Bun stream the console sink needs; tests pass a fake. */
export interface TextStream {
  isTTY?: boolean;
  write: (text: string) => unknown;
}

export interface ConsoleSinkOptions {
  /** Colours in `pretty`; default: only on a TTY and without `NO_COLOR`. */
  color?: boolean;
  format: LogFormat;
  /** warn and error. */
  stderr?: TextStream;
  /** debug and info. */
  stdout?: TextStream;
  /** Name in the start block of `pretty` (default: the record's app). */
  title?: string;
}

/** https://no-color.org: any non-empty `NO_COLOR` turns colours off. */
export function colorAllowed(
  stream: TextStream,
  env: Record<string, string | undefined> = process.env
): boolean {
  return stream.isTTY === true && !env.NO_COLOR;
}

/**
 * debug/info on stdout, warn/error on stderr. `pretty` uses the Next.js-like console lines
 * (formatConsole); the files keep the full `formatPretty`/JSON lines.
 */
export function createConsoleSink(opts: ConsoleSinkOptions): LogSink {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const colorOut = opts.color ?? colorAllowed(stdout);
  const colorErr = opts.color ?? colorAllowed(stderr);
  return {
    write(record) {
      const toErr = record.level === "warn" || record.level === "error";
      const line =
        opts.format === "json"
          ? formatJson(record)
          : formatConsole(record, {
              color: toErr ? colorErr : colorOut,
              repoRoot: REPO_ROOT,
              title: opts.title ?? record.app,
            });
      (toErr ? stderr : stdout).write(`${line}\n`);
    },
    flush: () => undefined,
    close: () => undefined,
  };
}
