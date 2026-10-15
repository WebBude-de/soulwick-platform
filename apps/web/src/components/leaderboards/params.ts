import type { LeaderboardKind, LeaderboardPeriod } from "@soulwick/contracts";
import type { Locale } from "@/i18n/locale";

/**
 * Query parameters of the leaderboards page. The slugs stay German in both locales so that
 * shared links keep working (`?art=gilden&zeitraum=saison&saison=2026-10`).
 */
export const KINDS = [
  { slug: "solo", kind: "solo" },
  { slug: "gruppe", kind: "group" },
  { slug: "gilden", kind: "guild" },
] as const satisfies readonly { slug: string; kind: LeaderboardKind }[];
export type KindOption = (typeof KINDS)[number];

export const PERIODS = [
  { slug: "allzeit", period: "all" },
  { slug: "saison", period: "season" },
] as const satisfies readonly { slug: string; period: LeaderboardPeriod }[];
export type PeriodOption = (typeof PERIODS)[number];

export const PAGE_SIZE = 50;

export interface Season {
  /** `YYYY-MM` in UTC, as the API expects it. */
  id: string;
  /** Localized month name with year. */
  label: string;
}

/** The current UTC month first, then the previous `count - 1` months. */
export function recentSeasons(
  locale: Locale,
  count: number,
  now = new Date()
): [Season, ...Season[]] {
  const months = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const seasonAt = (monthsBack: number): Season => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1)
    );
    const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { id, label: months.format(d) };
  };
  return [
    seasonAt(0),
    ...Array.from({ length: count - 1 }, (_, i) => seasonAt(i + 1)),
  ];
}

export type SearchParams = Record<string, string | string[] | undefined>;

export interface BoardSelection {
  kind: KindOption;
  period: PeriodOption;
  season: Season;
  seasons: [Season, ...Season[]];
}

/** Resolves the query string to a valid selection; unknown values fall back to the defaults. */
export function selectBoard(
  params: SearchParams,
  locale: Locale
): BoardSelection {
  const pick = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const kind = KINDS.find((k) => k.slug === pick("art")) ?? KINDS[0];
  const period = PERIODS.find((p) => p.slug === pick("zeitraum")) ?? PERIODS[0];
  const seasons = recentSeasons(locale, 6);
  const season = seasons.find((s) => s.id === pick("saison")) ?? seasons[0];
  return { kind, period, seasons, season };
}

/** Query string for a variation of the current selection (season only kept for `saison`). */
export function boardQuery(
  selection: BoardSelection,
  overrides: Record<string, string>
): Record<string, string> {
  const p = new URLSearchParams({
    art: selection.kind.slug,
    zeitraum: selection.period.slug,
    ...overrides,
  });
  if (p.get("zeitraum") === "saison") {
    if (!p.has("saison")) {
      p.set("saison", selection.season.id);
    }
  } else {
    p.delete("saison");
  }
  return Object.fromEntries(p);
}

/** Query string for the API call behind a selection. */
export function apiQuery(selection: BoardSelection): string {
  const query = new URLSearchParams({
    period: selection.period.period,
    limit: String(PAGE_SIZE),
  });
  if (selection.period.period === "season") {
    query.set("season", selection.season.id);
  }
  return query.toString();
}
