/** Log levels from the most to the least verbose; `LOG_LEVEL` is one of these or `silent`. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Values of `LOG_LEVEL`: the lowest level that is written, `silent` writes nothing (tests). */
export const LOG_THRESHOLDS = [...LOG_LEVELS, "silent"] as const;
export type LogThreshold = (typeof LOG_THRESHOLDS)[number];

/** Values of `LOG_FORMAT`: `pretty` = one readable line, `json` = one JSON object per line. */
export const LOG_FORMATS = ["pretty", "json"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

const RANK: Record<LogThreshold, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export function isLevelEnabled(
  threshold: LogThreshold,
  level: LogLevel
): boolean {
  return RANK[level] >= RANK[threshold];
}

/** One log entry; `fields` never contain packet contents, tokens, passwords or e-mail addresses. */
export interface LogRecord {
  app: string;
  fields: Record<string, unknown>;
  level: LogLevel;
  msg: string;
  time: Date;
}
