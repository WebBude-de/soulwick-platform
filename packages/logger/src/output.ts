import { isAbsolute, resolve } from "node:path";
import { createFileSink } from "./file-sink.ts";
import type { LogFormat } from "./levels.ts";
import { REPO_ROOT } from "./paths.ts";
import { createConsoleSink, type LogSink, type TextStream } from "./sinks.ts";

/** TESTWERT: day folders kept per app (today included). */
export const DEFAULT_LOG_RETENTION_DAYS = 7;
/** Log root outside production when LOG_DIR is not set. */
export const DEFAULT_LOG_DIR = resolve(REPO_ROOT, "logs");
/** LOG_DIR values that switch the files off. */
const OFF_VALUES = new Set(["off", "none", "false", "0"]);

export interface LogSettingsInput {
  /** LOG_DIR: empty = default (repo-root/logs, none in production), `off` = no files. */
  dir?: string;
  /** LOG_FORMAT: empty = pretty, in production json. */
  format?: LogFormat | "";
  nodeEnv?: string;
  /** LOG_RETENTION_DAYS. */
  retentionDays?: number;
}

export interface LogSettings {
  /** Absolute log root, or null = console only. */
  dir: string | null;
  format: LogFormat;
  retentionDays: number;
}

/** Applies the defaults: production = JSON on stdout without files, otherwise pretty plus files. */
export function resolveLogSettings(input: LogSettingsInput): LogSettings {
  const production = input.nodeEnv === "production";
  const rawDir = input.dir?.trim() ?? "";
  let dir: string | null;
  if (OFF_VALUES.has(rawDir.toLowerCase())) {
    dir = null;
  } else if (rawDir) {
    dir = isAbsolute(rawDir) ? rawDir : resolve(REPO_ROOT, rawDir);
  } else {
    dir = production ? null : DEFAULT_LOG_DIR;
  }
  return {
    dir,
    format: input.format || (production ? "json" : "pretty"),
    retentionDays: input.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS,
  };
}

export interface LogOutputOptions {
  app: string;
  color?: boolean;
  flushIntervalMs?: number | null;
  settings: LogSettings;
  stderr?: TextStream;
  stdout?: TextStream;
  /** Name in the console start block, e.g. `Soulwick API` (default: app). */
  title?: string;
}

export interface LogOutput extends LogSink {
  /** Folder of this app's files (`<dir>/<app>`), null = console only. */
  readonly appDir: string | null;
}

/**
 * Console plus (with a log root) daily files. If the folder cannot be written, one warning goes to
 * stderr and the app keeps logging to the console only.
 */
export function createLogOutput(opts: LogOutputOptions): LogOutput {
  const consoleSink = createConsoleSink({
    format: opts.settings.format,
    color: opts.color,
    stdout: opts.stdout,
    stderr: opts.stderr,
    title: opts.title ?? opts.app,
  });
  const { dir } = opts.settings;
  const fileSink = dir
    ? createFileSink({
        app: opts.app,
        dir,
        retentionDays: opts.settings.retentionDays,
        flushIntervalMs: opts.flushIntervalMs,
        onFailure: (error, appDir) =>
          consoleSink.write({
            app: opts.app,
            level: "warn",
            msg: "log_files_disabled",
            fields: {
              dir: appDir,
              error: error instanceof Error ? error.message : String(error),
            },
            time: new Date(),
          }),
      })
    : null;
  const sinks: LogSink[] = fileSink ? [consoleSink, fileSink] : [consoleSink];
  return {
    appDir: dir ? resolve(dir, opts.app) : null,
    write(record) {
      for (const sink of sinks) {
        sink.write(record);
      }
    },
    flush() {
      for (const sink of sinks) {
        sink.flush();
      }
    },
    close() {
      for (const sink of sinks) {
        sink.close();
      }
    },
  };
}
