/**
 * @soulwick/logger: the one logger of the API and the relay. Levels debug/info/warn/error (plus
 * silent), console as pretty line or JSON, and outside production daily files under
 * `logs/<app>/<YYYY-MM-DD>/`. Setup per app: `src/lib/logger.ts` (API), `src/logger.ts` (relay).
 */
export {
  type ConsoleFormatOptions,
  formatConsole,
} from "./console-format.ts";
export {
  createFileSink,
  type FileSinkOptions,
  localDay,
  pruneDayFolders,
} from "./file-sink.ts";
export { formatJson, formatPretty } from "./format.ts";
export {
  isLevelEnabled,
  LOG_FORMATS,
  LOG_LEVELS,
  LOG_THRESHOLDS,
  type LogFormat,
  type LogLevel,
  type LogRecord,
  type LogThreshold,
} from "./levels.ts";
export {
  createLogger,
  currentLogOutput,
  type LogFields,
  type Logger,
  type LoggerOptions,
  setLogOutput,
  silentLogger,
} from "./logger.ts";
export {
  createLogOutput,
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_RETENTION_DAYS,
  type LogOutput,
  type LogOutputOptions,
  type LogSettings,
  type LogSettingsInput,
  resolveLogSettings,
} from "./output.ts";
export { REPO_ROOT } from "./paths.ts";
export {
  type ConsoleSinkOptions,
  colorAllowed,
  createConsoleSink,
  type LogSink,
  type TextStream,
} from "./sinks.ts";
