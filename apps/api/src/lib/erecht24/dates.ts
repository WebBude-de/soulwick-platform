/**
 * eRecht24 sends `created`/`modified` as `YYYY-MM-DD HH:MM:SS` wall-clock time in Europe/Berlin
 * (no zone), while `pushed` was observed as ISO 8601 with zone. Both are turned into `Date`
 * instances here without external libraries: the Berlin offset comes from `Intl`.
 */

const ERECHT24_TIME_ZONE = "Europe/Berlin";
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;
/** PHP's zero date and similar placeholders are not real timestamps. */
const MIN_YEAR = 1900;

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
/** JS engines only guarantee millisecond precision when parsing; cut longer fractions. */
const EXCESS_FRACTION = /(\.\d{3})\d+/;

const berlinWallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: ERECHT24_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Offset of Europe/Berlin at the given instant in minutes east of UTC (60 winter, 120 summer). */
export function berlinOffsetMinutes(utcMs: number): number {
  const wholeSeconds = Math.floor(utcMs / MS_PER_SECOND) * MS_PER_SECOND;
  const parts = berlinWallClock.formatToParts(new Date(wholeSeconds));
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second")
  );
  return Math.round((asUtc - wholeSeconds) / MS_PER_MINUTE);
}

function parseLocalBerlin(match: RegExpExecArray): Date | null {
  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  if (year < MIN_YEAR) {
    return null;
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Date.UTC silently rolls over 2026-02-30 or 25:00; reject such input instead.
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  // The offset depends on the instant we are looking for; two passes settle DST edges.
  const guess = wall - berlinOffsetMinutes(wall) * MS_PER_MINUTE;
  return new Date(wall - berlinOffsetMinutes(guess) * MS_PER_MINUTE);
}

/**
 * Parses an eRecht24 timestamp. Returns null for empty, placeholder or malformed values so a
 * broken date never blocks a legal text from being cached.
 */
export function parseErecht24Date(
  value: string | null | undefined
): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (ISO_WITH_ZONE.test(trimmed)) {
    const date = new Date(trimmed.replace(EXCESS_FRACTION, "$1"));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match: RegExpExecArray | null = LOCAL_DATE_TIME.exec(trimmed);
  return match === null ? null : parseLocalBerlin(match);
}
