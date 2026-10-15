import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardPeriod,
  LeaderboardResponse,
} from "@soulwick/contracts";
import { getTranslations } from "next-intl/server";
import { SectionIntro } from "@/components/ui/section-intro";
import type { Locale } from "@/i18n/locale";
import { apiGet } from "@/lib/api";
import { LeaderboardBoard, type TeaserBoards } from "./leaderboard-board";

const KINDS: LeaderboardKind[] = ["solo", "group", "guild"];
const PERIODS: LeaderboardPeriod[] = ["season", "all"];

async function loadBoards(): Promise<TeaserBoards> {
  const results = await Promise.all(
    PERIODS.flatMap((period) =>
      KINDS.map(async (kind) => {
        const res = await apiGet<LeaderboardResponse>(
          `/leaderboards/${kind}?period=${period}&limit=5`
        );
        return { period, kind, entries: res.ok ? res.data.entries : null };
      })
    )
  );
  const boards = {
    season: { solo: null, group: null, guild: null },
    all: { solo: null, group: null, guild: null },
  } as Record<
    LeaderboardPeriod,
    Record<LeaderboardKind, LeaderboardEntry[] | null>
  >;
  for (const r of results) {
    boards[r.period][r.kind] = r.entries;
  }
  return boards;
}

export async function LeaderboardTeaser({ locale }: { locale: Locale }) {
  const t = await getTranslations("landing");
  const boards = await loadBoards();
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date());
  const periods = t.raw("lbPeriods") as string[];

  return (
    <section
      aria-labelledby="leaderboards-title"
      className="bg-bg-deep py-16 md:py-20"
      id="ranglisten"
    >
      <div className="container-site flex flex-col gap-8">
        <SectionIntro
          eyebrow={t("lbEyebrow")}
          id="leaderboards-title"
          text={t("lbText")}
          title={t("lbTitle")}
        />
        <LeaderboardBoard
          allHref="/leaderboards"
          allTimeLabel={periods[1] ?? "All-time"}
          boards={boards}
          seasonLabel={t("lbSeason", { month })}
        />
      </div>
    </section>
  );
}
