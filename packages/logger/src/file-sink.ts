import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type FileSink, file } from "bun";
import { formatJson, formatPretty } from "./format.ts";
import type { LogSink } from "./sinks.ts";

/** Day folders under `<dir>/<app>/`. */
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;
/** Buffered bytes per file before Bun writes them out on its own. */
const HIGH_WATER_MARK = 64 * 1024;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

export interface FileSinkOptions {
  /** Name of the app folder (`api`, `relay`). */
  app: string;
  /** Log root; files go to `<dir>/<app>/<YYYY-MM-DD>/`. */
  dir: string;
  /** How often buffered lines are written out; null = only on flush/close (tests). */
  flushIntervalMs?: number | null;
  /** Called once when the folder cannot be written; the sink then drops everything. */
  onFailure?: (error: unknown, appDir: string) => void;
  /** Day folders kept, today included (TESTWERT 7); older ones are deleted on rotation. */
  retentionDays: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar day `YYYY-MM-DD` (the developer's day, not UTC). */
export function localDay(time: Date): string {
  return `${time.getFullYear()}-${pad2(time.getMonth() + 1)}-${pad2(time.getDate())}`;
}

/** Deletes day folders older than `retentionDays` days counted back from `today`. */
export function pruneDayFolders(
  appDir: string,
  today: Date,
  retentionDays: number
): string[] {
  const oldestKept = localDay(
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - (retentionDays - 1)
    )
  );
  const removed: string[] = [];
  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      DAY_FOLDER.test(entry.name) &&
      entry.name < oldestKept
    ) {
      rmSync(join(appDir, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}

interface OpenFile {
  fd: number;
  writer: FileSink;
}

/**
 * Daily log files: `all.jsonl` (everything, JSON), `all.log` (everything, pretty without colours)
 * and one `<level>.jsonl` per level with only that level. Lines are buffered in Bun file writers
 * (append mode) and written out every second, when the buffer is full, and on flush/close.
 * Any file system error disables the sink once (`onFailure`); logging never crashes the app.
 */
export function createFileSink(opts: FileSinkOptions): LogSink {
  const appDir = join(opts.dir, opts.app);
  const files = new Map<string, OpenFile>();
  let day: string | null = null;
  let stopped = false;

  const closeFiles = () => {
    for (const open of files.values()) {
      try {
        open.writer.end();
        closeSync(open.fd);
      } catch {
        // Closing is best effort; the data was already handed to the writer.
      }
    }
    files.clear();
  };

  const fail = (error: unknown) => {
    if (stopped) {
      return;
    }
    stopped = true;
    closeFiles();
    opts.onFailure?.(error, appDir);
  };

  const rotate = (time: Date) => {
    const next = localDay(time);
    if (next === day) {
      return;
    }
    closeFiles();
    mkdirSync(join(appDir, next), { recursive: true });
    day = next;
    try {
      pruneDayFolders(appDir, time, opts.retentionDays);
    } catch {
      // Old folders that cannot be deleted do not stop logging.
    }
  };

  const append = (name: string, text: string) => {
    let open = files.get(name);
    if (!open) {
      const fd = openSync(join(appDir, day ?? "", name), "a");
      open = {
        fd,
        writer: file(fd).writer({ highWaterMark: HIGH_WATER_MARK }),
      };
      files.set(name, open);
    }
    open.writer.write(text);
  };

  const flush = () => {
    if (stopped) {
      return;
    }
    try {
      for (const open of files.values()) {
        open.writer.flush();
      }
    } catch (error) {
      fail(error);
    }
  };

  const intervalMs =
    opts.flushIntervalMs === undefined
      ? DEFAULT_FLUSH_INTERVAL_MS
      : opts.flushIntervalMs;
  const timer = intervalMs === null ? null : setInterval(flush, intervalMs);
  timer?.unref();

  return {
    write(record) {
      if (stopped) {
        return;
      }
      try {
        rotate(record.time);
        const json = `${formatJson(record)}\n`;
        append("all.jsonl", json);
        append("all.log", `${formatPretty(record, { color: false })}\n`);
        append(`${record.level}.jsonl`, json);
      } catch (error) {
        fail(error);
      }
    },
    flush,
    close() {
      if (timer) {
        clearInterval(timer);
      }
      flush();
      closeFiles();
      stopped = true;
    },
  };
}
