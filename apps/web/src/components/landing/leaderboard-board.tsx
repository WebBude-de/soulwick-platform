"use client";

import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardPeriod,
} from "@soulwick/contracts";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

/** Entries per period and kind; `null` = API unreachable. */
export type TeaserBoards = Record<
  LeaderboardPeriod,
  Record<LeaderboardKind, LeaderboardEntry[] | null>
>;

interface LeaderboardBoardProps {
  /** Localized link to the full leaderboards page. */
  allHref: string;
  allTimeLabel: string;
  boards: TeaserBoards;
  /** Localized season label, e.g. „Saison Oktober“ (computed on the server). */
  seasonLabel: string;
}

const KINDS: LeaderboardKind[] = ["solo", "group", "guild"];
const KIND_ICONS: Record<LeaderboardKind, SpriteId> = {
  solo: "icon_sword",
  group: "icon_host",
  guild: "icon_leaderboard",
};

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function LeaderboardBoard({
  boards,
  seasonLabel,
  allTimeLabel,
  allHref,
}: LeaderboardBoardProps) {
  const t = useTranslations("landing");
  const [period, setPeriod] = useState<LeaderboardPeriod>("season");
  const [kind, setKind] = useState<LeaderboardKind>("solo");
  const baseId = useId();
  const tabs = t.raw("lbTabs") as string[];
  const heads = t.raw("lbHeads") as string[];
  const entries = boards[period][kind];
  const headIndex = KINDS.indexOf(kind);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <fieldset className="lb-seg">
          <legend className="sr-only">{t("lbPeriodLabel")}</legend>
          <button
            aria-pressed={period === "season"}
            onClick={() => setPeriod("season")}
            type="button"
          >
            {seasonLabel}
          </button>
          <button
            aria-pressed={period === "all"}
            onClick={() => setPeriod("all")}
            type="button"
          >
            {allTimeLabel}
          </button>
        </fieldset>
      </div>

      <div className="card card-deep overflow-hidden">
        <div aria-label={t("lbTabsLabel")} className="lb-tabs" role="tablist">
          {KINDS.map((k, i) => (
            <button
              aria-controls={`${baseId}-panel`}
              aria-selected={kind === k}
              className="lb-tab"
              id={`${baseId}-tab-${k}`}
              key={k}
              onClick={() => setKind(k)}
              role="tab"
              type="button"
            >
              <Sprite id={KIND_ICONS[k]} scale={1} />
              {tabs[i]}
            </button>
          ))}
        </div>

        <div
          aria-labelledby={`${baseId}-tab-${kind}`}
          className="overflow-x-auto"
          id={`${baseId}-panel`}
          role="tabpanel"
        >
          {entries && entries.length > 0 ? (
            <table className="lb-table">
              <thead>
                <tr>
                  <th className="w-24" scope="col">
                    {t("lbRank")}
                  </th>
                  <th className="w-full" scope="col">
                    {heads[headIndex]}
                  </th>
                  <th className="w-24 text-right" scope="col">
                    {t("lbRoom")}
                  </th>
                  <th className="w-28 text-right" scope="col">
                    {t("lbTime")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 5).map((entry) => {
                  const cycle = Math.max(1, Math.ceil(entry.roomReached / 5));
                  const sub =
                    kind === "guild"
                      ? t("lbMembers", { n: entry.memberCount ?? 0 })
                      : [
                          t("lbCycle", { n: cycle }),
                          entry.tag ? `[${entry.tag}]` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                  return (
                    <tr
                      data-top={entry.rank === 1 ? "" : undefined}
                      key={entry.runId}
                    >
                      <td className="w-24">
                        <span className="inline-flex items-center gap-2">
                          {entry.rank === 1 ? (
                            <span className="lb-trophy">
                              <Sprite id="trophy_icon" scale={1} />
                            </span>
                          ) : entry.rank <= 3 ? (
                            <span className="lb-spin">
                              <Sprite id="gold_coin_4f" scale={1} still />
                            </span>
                          ) : (
                            <span className="inline-block w-4" />
                          )}
                          <span
                            className={`lb-num ${entry.rank <= 3 ? "text-gold" : "text-muted"}`}
                          >
                            {entry.rank}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="block font-semibold text-[15px] text-text">
                          {entry.name}
                        </span>
                        <span className="block text-[13px] text-muted">
                          {sub}
                        </span>
                      </td>
                      <td className="lb-num text-right text-gold">
                        {entry.roomReached}
                      </td>
                      <td className="lb-num whitespace-nowrap text-right text-soft">
                        {formatDuration(entry.durationSeconds)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <Sprite id="skull_icon" scale={2} />
              <p className="text-[15px] text-muted">
                {entries === null ? t("lbUnavailable") : t("lbEmpty")}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-line border-t-2 px-5 py-3">
          <p className="text-[13px] text-muted">
            {entries === null ? t("lbUnavailable") : t("lbLive")}
          </p>
          <a
            className="font-pixel text-[14px] text-gold hover:underline"
            href={allHref}
            style={{ fontWeight: 400 }}
          >
            {t("lbAll")} →
          </a>
        </div>
      </div>
    </div>
  );
}
