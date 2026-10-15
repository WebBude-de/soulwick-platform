import type { Prisma } from "@soulwick/db";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Prisma filter for the `from`/`to` query parameters of the admin lists (audit log, deletion
 * log; P-023): both inclusive, a day ("2026-10-15") means 00:00 UTC for `from` and up to the end
 * of that day (UTC) for `to`. Undefined when neither is set.
 */
export function timeRangeFilter(
  from: string | undefined,
  to: string | undefined
): Prisma.DateTimeFilter | undefined {
  if (!(from || to)) {
    return;
  }
  const filter: Prisma.DateTimeFilter = {};
  if (from) {
    filter.gte = new Date(
      DATE_ONLY.test(from) ? `${from}T00:00:00.000Z` : from
    );
  }
  if (to) {
    if (DATE_ONLY.test(to)) {
      filter.lt = new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS);
    } else {
      filter.lte = new Date(to);
    }
  }
  return filter;
}
