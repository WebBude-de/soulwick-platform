export interface Logger {
  error: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
}

/**
 * JSON lines on stdout/stderr (same format as the API), readable in `docker logs` and Dokploy.
 * Never pass packet contents or tokens: only ids, room codes, counters and reasons.
 */
export function createLogger(level: "info" | "error" | "silent"): Logger {
  const write = (
    stream: NodeJS.WriteStream,
    lvl: string,
    msg: string,
    fields?: Record<string, unknown>
  ) =>
    stream.write(
      `${JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields })}\n`
    );
  return {
    info: (msg, fields) => {
      if (level === "info") {
        write(process.stdout, "info", msg, fields);
      }
    },
    error: (msg, fields) => {
      if (level !== "silent") {
        write(process.stderr, "error", msg, fields);
      }
    },
  };
}
