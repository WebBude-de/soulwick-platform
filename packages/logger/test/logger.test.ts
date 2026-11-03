import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  colorAllowed,
  createConsoleSink,
  createFileSink,
  createLogger,
  createLogOutput,
  DEFAULT_LOG_DIR,
  formatConsole,
  formatJson,
  formatPretty,
  type LogRecord,
  type LogSink,
  localDay,
  REPO_ROOT,
  resolveLogSettings,
} from "../src/index.ts";

/** 22.10.2026 12:34:56.789 local time. */
const NOON = new Date(2026, 9, 22, 12, 34, 56, 789);

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    app: "api",
    level: "info",
    msg: "request",
    fields: {},
    time: NOON,
    ...overrides,
  };
}

function memorySink() {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    write: (r) => records.push(r),
    flush: () => undefined,
    close: () => undefined,
  };
  return { records, sink };
}

function memoryStream(isTTY = false) {
  const chunks: string[] = [];
  return {
    chunks,
    stream: { isTTY, write: (text: string) => chunks.push(text) },
  };
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "soulwick-logger-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function lines(path: string): string[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

describe("level filter", () => {
  it("writes the threshold and everything above it", () => {
    const { records, sink } = memorySink();
    const logger = createLogger({ app: "api", level: "warn", output: sink });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(records.map((r) => `${r.level}:${r.msg}`)).toEqual([
      "warn:w",
      "error:e",
    ]);
  });

  it("debug writes all levels, silent none", () => {
    const all = memorySink();
    const debug = createLogger({
      app: "relay",
      level: "debug",
      output: all.sink,
    });
    debug.debug("a");
    debug.info("b");
    expect(all.records.map((r) => r.level)).toEqual(["debug", "info"]);

    const none = memorySink();
    const silent = createLogger({
      app: "relay",
      level: "silent",
      output: none.sink,
    });
    silent.error("x");
    expect(none.records).toHaveLength(0);
  });

  it("stamps app, fields and the injected clock and never throws", () => {
    const { records, sink } = memorySink();
    const logger = createLogger({
      app: "api",
      level: "info",
      output: sink,
      now: () => NOON,
    });
    logger.info("hello", { conn: 1 });
    expect(records[0]).toEqual({
      app: "api",
      level: "info",
      msg: "hello",
      fields: { conn: 1 },
      time: NOON,
    });
    const broken = createLogger({
      app: "api",
      level: "info",
      output: {
        write: () => {
          throw new Error("disk gone");
        },
        flush: () => undefined,
        close: () => undefined,
      },
    });
    expect(() => broken.info("x")).not.toThrow();
  });
});

describe("formats", () => {
  it("json keeps the core keys first and protects them", () => {
    const line = formatJson(
      record({ fields: { msg: "spoofed", status: 200, big: 1n } })
    );
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).slice(0, 4)).toEqual([
      "time",
      "level",
      "app",
      "msg",
    ]);
    expect(parsed.msg).toBe("request");
    expect(parsed.time).toBe(NOON.toISOString());
    expect(parsed.status).toBe(200);
    expect(parsed.big).toBe("1");
  });

  it("json serialises errors with message and stack", () => {
    const parsed = JSON.parse(
      formatJson(record({ fields: { err: new Error("boom") } }))
    );
    expect(parsed.err.message).toBe("boom");
    expect(parsed.err.stack).toContain("boom");
  });

  it("pretty renders requests like an access log", () => {
    const line = formatPretty(
      record({
        fields: {
          method: "GET",
          path: "/admin/me",
          status: 200,
          ms: 3,
          ip: "::1",
          code: undefined,
        },
      }),
      { color: false }
    );
    expect(line).toBe(
      "12:34:56.789 INFO  api  request  GET /admin/me 200 3ms ip=::1"
    );
  });

  it("pretty quotes spaces, keeps nested values compact and indents stacks", () => {
    const line = formatPretty(
      record({
        level: "error",
        msg: "unhandled_error",
        fields: {
          error: "no such table",
          room: { code: "ABCD", players: 2 },
          stack: "Error: no such table\n    at query (db.ts:1:1)",
        },
      }),
      { color: false }
    );
    expect(line.split("\n")).toEqual([
      '12:34:56.789 ERROR api  unhandled_error  error="no such table" room={"code":"ABCD","players":2}',
      "    Error: no such table",
      "        at query (db.ts:1:1)",
    ]);
  });

  it("pretty shows the first line of multi-line strings and the rest below", () => {
    const line = formatPretty(
      record({
        level: "error",
        msg: "housekeeping_failed",
        fields: {
          error: "\nInvalid `db.x()` invocation\nThe table does not exist.",
        },
      }),
      { color: false }
    );
    expect(line.split("\n")).toEqual([
      '12:34:56.789 ERROR api  housekeeping_failed  error="Invalid `db.x()` invocation …"',
      "    Invalid `db.x()` invocation",
      "    The table does not exist.",
    ]);
  });

  it("pretty colours only when asked", () => {
    const plain = formatPretty(record({ level: "warn" }), { color: false });
    const colored = formatPretty(record({ level: "warn" }), { color: true });
    expect(plain).not.toContain("\u001b[");
    expect(colored).toContain("\u001b[33mWARN \u001b[0m");
  });
});

describe("console format (pretty)", () => {
  const plain = { color: false, repoRoot: "/repo", title: "Soulwick API" };

  it("turns listening into the start block", () => {
    const text = formatConsole(
      record({
        msg: "listening",
        fields: {
          port: 3102,
          url: "http://localhost:3102",
          logDir: "/repo/logs/api",
          readyMs: 120,
        },
      }),
      plain
    );
    expect(text.split("\n")).toEqual([
      "12:34:56.789 ▲ Soulwick API",
      "             - Local:  http://localhost:3102",
      "             - Logs:   logs/api/",
      "12:34:56.789 ✓ Ready in 120ms",
    ]);
    const relay = formatConsole(
      record({
        app: "relay",
        msg: "listening",
        fields: {
          port: 3103,
          url: "ws://localhost:3103/v1",
          protocolVersion: 1,
          logDir: "/tmp/elsewhere/relay",
        },
      }),
      { ...plain, title: "Soulwick Relay" }
    );
    expect(relay.split("\n")).toEqual([
      "12:34:56.789 ▲ Soulwick Relay  protocolVersion=1",
      "             - Local:  ws://localhost:3103/v1",
      "             - Logs:   /tmp/elsewhere/relay/",
    ]);
  });

  it("renders requests with status, duration and every field", () => {
    const ok = formatConsole(
      record({
        fields: {
          method: "GET",
          path: "/leaderboards/solo",
          status: 200,
          ms: 16,
          ip: "::1",
        },
      }),
      plain
    );
    expect(ok).toBe(
      "12:34:56.789   GET /leaderboards/solo 200 in 16ms  ip=::1"
    );
    const denied = formatConsole(
      record({
        level: "warn",
        fields: {
          method: "GET",
          path: "/admin/me",
          status: 401,
          ms: 1,
          ip: "::1",
          code: "unauthorized",
        },
      }),
      plain
    );
    expect(denied).toBe(
      "12:34:56.789 ⚠ GET /admin/me 401 in 1ms  ip=::1 code=unauthorized"
    );
    const colored = formatConsole(
      record({
        level: "error",
        fields: { method: "GET", path: "/x", status: 500, ms: 3 },
      }),
      { ...plain, color: true }
    );
    expect(colored).toContain(
      "\u001b[31m⨯\u001b[0m GET /x \u001b[31m500\u001b[0m"
    );
    expect(colored).toContain("\u001b[2m in 3ms\u001b[0m");
  });

  it("uses symbols per level, keeps fields and indents stacks under the symbol", () => {
    expect(
      formatConsole(
        record({ msg: "housekeeping_done", fields: { removed: 3 } }),
        plain
      )
    ).toBe("12:34:56.789 ○ housekeeping_done  removed=3");
    expect(
      formatConsole(
        record({
          level: "warn",
          msg: "connection_rejected",
          fields: { ip: "::1", reason: "rate_limited" },
        }),
        plain
      )
    ).toBe("12:34:56.789 ⚠ connection_rejected  ip=::1 reason=rate_limited");
    expect(
      formatConsole(
        record({
          level: "debug",
          msg: "message",
          fields: { conn: 1, type: "hello" },
        }),
        plain
      )
    ).toBe("12:34:56.789 · message  conn=1 type=hello");
    const failed = formatConsole(
      record({
        level: "error",
        msg: "housekeeping_failed",
        fields: {
          table: "cloud_world_backups",
          stack: "Error: gone\n    at run (x.ts:1:1)",
        },
      }),
      plain
    );
    expect(failed.split("\n")).toEqual([
      "12:34:56.789 ⨯ housekeeping_failed  table=cloud_world_backups",
      "               Error: gone",
      "                   at run (x.ts:1:1)",
    ]);
  });

  it("shows the stop signal with all statistics", () => {
    expect(
      formatConsole(
        record({
          app: "relay",
          msg: "signal",
          fields: { signal: "SIGTERM", rooms: 2, players: 5 },
        }),
        plain
      )
    ).toBe("12:34:56.789 ○ Stopped (SIGTERM)  rooms=2 players=5");
  });

  it("console is pretty, all.log keeps the full line with level and app", () => {
    const dir = tempDir();
    const out = memoryStream();
    const output = createLogOutput({
      app: "relay",
      title: "Soulwick Relay",
      settings: { format: "pretty", dir, retentionDays: 7 },
      flushIntervalMs: null,
      stdout: out.stream,
      stderr: memoryStream().stream,
      color: false,
    });
    output.write(
      record({ app: "relay", msg: "room_created", fields: { room: "ABCD" } })
    );
    output.close();
    expect(out.chunks).toEqual(["12:34:56.789 ○ room_created  room=ABCD\n"]);
    expect(lines(join(dir, "relay", "2026-10-22", "all.log"))).toEqual([
      "12:34:56.789 INFO  relay  room_created  room=ABCD",
    ]);
  });
});

describe("console sink", () => {
  it("debug/info go to stdout, warn/error to stderr", () => {
    const out = memoryStream();
    const err = memoryStream();
    const sink = createConsoleSink({
      format: "json",
      stdout: out.stream,
      stderr: err.stream,
    });
    sink.write(record({ level: "debug" }));
    sink.write(record({ level: "info" }));
    sink.write(record({ level: "warn" }));
    sink.write(record({ level: "error" }));
    expect(out.chunks.map((c) => JSON.parse(c).level)).toEqual([
      "debug",
      "info",
    ]);
    expect(err.chunks.map((c) => JSON.parse(c).level)).toEqual([
      "warn",
      "error",
    ]);
    expect(out.chunks.every((c) => c.endsWith("\n"))).toBe(true);
  });

  it("colours only on a TTY and without NO_COLOR", () => {
    expect(colorAllowed({ isTTY: true, write: () => 0 }, {})).toBe(true);
    expect(colorAllowed({ isTTY: false, write: () => 0 }, {})).toBe(false);
    expect(
      colorAllowed({ isTTY: true, write: () => 0 }, { NO_COLOR: "1" })
    ).toBe(false);
    const tty = memoryStream(true);
    createConsoleSink({ format: "pretty", stdout: tty.stream }).write(record());
    expect(tty.chunks[0]).toContain("\u001b[");
  });
});

describe("file sink", () => {
  it("splits into all.jsonl, all.log and one file per level", () => {
    const dir = tempDir();
    const sink = createFileSink({
      app: "api",
      dir,
      retentionDays: 7,
      flushIntervalMs: null,
    });
    sink.write(record({ level: "debug", msg: "d" }));
    sink.write(record({ level: "info", msg: "i" }));
    sink.write(record({ level: "warn", msg: "w" }));
    sink.write(record({ level: "error", msg: "e", fields: { status: 500 } }));
    sink.write(record({ level: "info", msg: "i2" }));
    sink.close();

    const dayDir = join(dir, "api", "2026-10-22");
    expect(readdirSync(dayDir).sort()).toEqual([
      "all.jsonl",
      "all.log",
      "debug.jsonl",
      "error.jsonl",
      "info.jsonl",
      "warn.jsonl",
    ]);
    const msgs = (name: string) =>
      lines(join(dayDir, name)).map((l) => JSON.parse(l).msg);
    expect(msgs("all.jsonl")).toEqual(["d", "i", "w", "e", "i2"]);
    expect(msgs("debug.jsonl")).toEqual(["d"]);
    expect(msgs("info.jsonl")).toEqual(["i", "i2"]);
    expect(msgs("warn.jsonl")).toEqual(["w"]);
    expect(msgs("error.jsonl")).toEqual(["e"]);
    const log = lines(join(dayDir, "all.log"));
    expect(log[3]).toBe("12:34:56.789 ERROR api  e  status=500");
    expect(log.join("\n")).not.toContain("\u001b[");
  });

  it("appends to the files of the same day after a restart", () => {
    const dir = tempDir();
    for (const msg of ["first", "second"]) {
      const sink = createFileSink({
        app: "relay",
        dir,
        retentionDays: 7,
        flushIntervalMs: null,
      });
      sink.write(record({ app: "relay", msg }));
      sink.close();
    }
    const all = lines(join(dir, "relay", "2026-10-22", "all.jsonl"));
    expect(all.map((l) => JSON.parse(l).msg)).toEqual(["first", "second"]);
  });

  it("rotates daily and keeps retentionDays day folders", () => {
    const dir = tempDir();
    const appDir = join(dir, "api");
    // Ten older days (12.10. to 21.10.) plus an unrelated folder that must survive.
    for (let d = 12; d <= 21; d += 1) {
      mkdirSync(join(appDir, localDay(new Date(2026, 9, d))), {
        recursive: true,
      });
    }
    mkdirSync(join(appDir, "keep-me"));
    const sink = createFileSink({
      app: "api",
      dir,
      retentionDays: 7,
      flushIntervalMs: null,
    });
    sink.write(record({ msg: "today" }));
    expect(readdirSync(appDir).sort()).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "keep-me",
    ]);

    // Past midnight: new folder, the oldest kept day goes.
    sink.write(
      record({ msg: "tomorrow", time: new Date(2026, 9, 23, 0, 0, 1) })
    );
    sink.close();
    expect(existsSync(join(appDir, "2026-10-16"))).toBe(false);
    expect(lines(join(appDir, "2026-10-22", "all.jsonl"))).toHaveLength(1);
    expect(
      JSON.parse(lines(join(appDir, "2026-10-23", "all.jsonl"))[0] ?? "").msg
    ).toBe("tomorrow");
  });

  it("does not crash when the folder cannot be written and reports once", () => {
    const dir = tempDir();
    const blocker = join(dir, "not-a-folder");
    writeFileSync(blocker, "x");
    const failures: string[] = [];
    const sink = createFileSink({
      app: "api",
      dir: blocker,
      retentionDays: 7,
      flushIntervalMs: null,
      onFailure: (_error, appDir) => failures.push(appDir),
    });
    expect(() => {
      sink.write(record());
      sink.write(record());
      sink.flush();
      sink.close();
    }).not.toThrow();
    expect(failures).toEqual([join(blocker, "api")]);
  });
});

describe("log output", () => {
  it("defaults: pretty with repo-root/logs locally, json without files in production", () => {
    expect(resolveLogSettings({ nodeEnv: "development" })).toEqual({
      format: "pretty",
      dir: DEFAULT_LOG_DIR,
      retentionDays: 7,
    });
    expect(DEFAULT_LOG_DIR).toBe(join(REPO_ROOT, "logs"));
    expect(resolveLogSettings({ nodeEnv: "production", format: "" })).toEqual({
      format: "json",
      dir: null,
      retentionDays: 7,
    });
    expect(
      resolveLogSettings({
        nodeEnv: "production",
        format: "pretty",
        dir: "/var/log/soulwick",
        retentionDays: 3,
      })
    ).toEqual({ format: "pretty", dir: "/var/log/soulwick", retentionDays: 3 });
    expect(resolveLogSettings({ dir: "off" }).dir).toBeNull();
    expect(resolveLogSettings({ dir: "tmp/logs" }).dir).toBe(
      join(REPO_ROOT, "tmp/logs")
    );
  });

  it("writes console and files; an unwritable folder warns once on stderr", () => {
    const dir = tempDir();
    const out = memoryStream();
    const err = memoryStream();
    const output = createLogOutput({
      app: "relay",
      settings: { format: "json", dir, retentionDays: 7 },
      flushIntervalMs: null,
      stdout: out.stream,
      stderr: err.stream,
    });
    expect(output.appDir).toBe(join(dir, "relay"));
    output.write(record({ app: "relay", msg: "room_created" }));
    output.close();
    expect(JSON.parse(out.chunks[0] ?? "").msg).toBe("room_created");
    expect(lines(join(dir, "relay", "2026-10-22", "info.jsonl"))).toHaveLength(
      1
    );

    const blocker = join(dir, "file");
    writeFileSync(blocker, "x");
    const broken = createLogOutput({
      app: "api",
      settings: { format: "json", dir: blocker, retentionDays: 7 },
      flushIntervalMs: null,
      stdout: out.stream,
      stderr: err.stream,
    });
    broken.write(record());
    broken.write(record());
    broken.close();
    const warnings = err.chunks.map((c) => JSON.parse(c));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toBe("log_files_disabled");
    expect(out.chunks).toHaveLength(3);
  });
});
