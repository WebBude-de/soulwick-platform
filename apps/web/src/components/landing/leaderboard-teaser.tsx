import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardPeriod,
  LeaderboardResponse,
} from "@soulwick/contracts";
import { getTranslations } from "next-intl/server";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
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

/** Guild emblems from the game, shown in the preview (frames of `guild_emblems`). */
const EMBLEMS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * "Who gets deepest?": the boards and guilds as a feature, described the same in both modes.
 * While the live functions are on (`LIVE_FEATURES`) the live boards follow; otherwise a quiet
 * preview says they go live at release, without any API call or link to `/leaderboards`.
 */
export async function LeaderboardTeaser({
  locale,
  live,
}: {
  locale: Locale;
  live: boolean;
}) {
  const t = await getTranslations("landing");
  const tabs = t.raw("lbTabs") as string[];

  return (
    <section
      aria-labelledby="leaderboards-title"
      className="lb-teaser"
      id="ranglisten"
    >
      <div className="container-site flex flex-col gap-8">
        <SectionIntro
          id="leaderboards-title"
          text={`${t("lbText")} ${t("lbGuilds")}`}
          title={t("lbTitle")}
        />
        {live ? (
          <LiveBoards locale={locale} />
        ) : (
          <div className="lb-preview">
            <ul aria-hidden="true" className="lb-preview-tabs">
              {tabs.map((tab) => (
                <li className="chip" key={tab}>
                  {tab}
                </li>
              ))}
            </ul>
            <p className="lb-preview-text">
              <Sprite id="trophy_icon" scale={2} />
              <span>{t("lbAtRelease")}</span>
            </p>
            <div aria-hidden="true" className="lb-preview-emblems">
              {EMBLEMS.map((frame) => (
                <Sprite
                  frame={frame}
                  id="guild_emblems"
                  key={frame}
                  scale={2}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

async function LiveBoards({ locale }: { locale: Locale }) {
  const t = await getTranslations("landing");
  const boards = await loadBoards();
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date());
  const periods = t.raw("lbPeriods") as string[];

  return (
    <LeaderboardBoard
      allHref="/leaderboards"
      allTimeLabel={periods[1] ?? "All-time"}
      boards={boards}
      seasonLabel={t("lbSeason", { month })}
    />
  );
}
