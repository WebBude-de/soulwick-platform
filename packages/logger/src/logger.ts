import {
  isLevelEnabled,
  type LogLevel,
  type LogRecord,
  type LogThreshold,
} from "./levels.ts";
import { createConsoleSink, type LogSink } from "./sinks.ts";

export type LogFields = Record<string, unknown>;

/**
 * What API and relay code calls. `fields` carry ids, codes, counters and reasons; never packet
 * contents, tokens, passwords or e-mail addresses.
 */
export interface Logger {
  debug: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
}

export interface LoggerOptions {
  /** Short app name in every line (`api`, `relay`). */
  app: string;
  /** `LOG_LEVEL`: lowest level written; `silent` writes nothing. */
  level: LogThreshold;
  /** Injectable clock (tests). */
  now?: () => Date;
  /** Default: the process-wide output set with `setLogOutput` (console only until then). */
  output?: LogSink;
}

let processOutput: LogSink | null = null;
let fallbackOutput: LogSink | null = null;

function fallbackFormat(): "pretty" | "json" {
  const format = process.env.LOG_FORMAT;
  if (format === "pretty" || format === "json") {
    return format;
  }
  return process.env.NODE_ENV === "production" ? "json" : "pretty";
}

/** The output loggers use when none is passed: the one from `setLogOutput`, else the console. */
export function currentLogOutput(): LogSink {
  if (processOutput) {
    return processOutput;
  }
  fallbackOutput ??= createConsoleSink({ format: fallbackFormat() });
  return fallbackOutput;
}

/**
 * Installs the output (console plus optional files) for every logger of this process that has
 * no own output. Called once at start-up (`src/index.ts`); tests never call it.
 */
export function setLogOutput(output: LogSink | null): void {
  processOutput = output;
}

/** Never throws: a broken output must not take a request or a room down. */
export function createLogger(opts: LoggerOptions): Logger {
  const now = opts.now ?? (() => new Date());
  const emit =
    (level: LogLevel) =>
    (msg: string, fields: LogFields = {}): void => {
      if (!isLevelEnabled(opts.level, level)) {
        return;
      }
      const record: LogRecord = {
        app: opts.app,
        level,
        msg,
        fields,
        time: now(),
      };
      try {
        (opts.output ?? currentLogOutput()).write(record);
      } catch {
        // Logging is best effort.
      }
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

/** For tests and callers that must not log. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
