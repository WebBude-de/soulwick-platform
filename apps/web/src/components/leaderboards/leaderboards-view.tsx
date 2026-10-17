import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardResponse,
} from "@soulwick/contracts";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import { type ApiResult, formatDuration } from "@/lib/api";
import type { SpriteId } from "@/lib/sprite-manifest";
import { type BoardSelection, boardQuery, KINDS, PERIODS } from "./params";
import { RankMedal } from "./rank-medal";

const KIND_ICON: Record<LeaderboardKind, SpriteId> = {
  solo: "icon_sword",
  group: "icon_host",
  guild: "icon_treasury",
};

type Query = Record<string, string>;

export function LeaderboardsView({
  selection,
  result,
}: {
  selection: BoardSelection;
  result: ApiResult<LeaderboardResponse>;
}) {
  const t = useTranslations("leaderboards");
  const isSeason = selection.period.period === "season";
  const periodLabel = isSeason ? selection.season.label : t("periods.all");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-3xl flex-col gap-3">
        <h1 className="candle-glow flex items-center gap-3 text-3xl text-gold sm:text-5xl">
          <Sprite id="icon_leaderboard" scale={3} />
          <span>{t("title")}</span>
        </h1>
        <p className="text-lg text-soft">{t("intro")}</p>
      </header>

      <div className="flex flex-col gap-4">
        <nav
          aria-label={t("filters.period")}
          className="flex flex-wrap items-center gap-3"
        >
          <span className="font-pixel text-muted text-sm">
            {t("filters.period")}
          </span>
          <ul className="inline-flex border-2 border-panel-edge bg-void shadow-px">
            {PERIODS.map((p) => (
              <SegmentLink
                active={p.slug === selection.period.slug}
                key={p.slug}
                query={boardQuery(selection, { zeitraum: p.slug })}
              >
                {p.period === "season"
                  ? `${t("periods.season")} ${selection.seasons[0].label}`
                  : t("periods.all")}
              </SegmentLink>
            ))}
          </ul>
        </nav>
        {isSeason ? (
          <nav
            aria-label={t("filters.season")}
            className="flex flex-wrap gap-2"
          >
            {selection.seasons.map((s) => (
              <Link
                aria-current={s.id === selection.season.id ? "page" : undefined}
                className={`pixel-chip ${s.id === selection.season.id ? "text-gold" : ""}`}
                href={{
                  pathname: "/leaderboards",
                  query: boardQuery(selection, {
                    zeitraum: "saison",
                    saison: s.id,
                  }),
                }}
                key={s.id}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <PixelPanel className="flex flex-col" variant="dark">
        <nav
          aria-label={t("filters.kind")}
          className="border-panel-edge border-b-2 px-2 sm:px-3"
        >
          <ul className="-mb-0.5 flex flex-wrap gap-1">
            {KINDS.map((k) => {
              const active = k.slug === selection.kind.slug;
              return (
                <li key={k.slug}>
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={[
                      "inline-flex min-h-12 items-center gap-2 border-b-2 px-3 font-pixel text-base transition-colors sm:text-lg",
                      active
                        ? "border-gold text-gold"
                        : "border-transparent text-soft hover:text-gold",
                    ].join(" ")}
                    href={{
                      pathname: "/leaderboards",
                      query: boardQuery(selection, { art: k.slug }),
                    }}
                  >
                    <Sprite id={KIND_ICON[k.kind]} scale={1} />
                    {t(`kinds.${k.kind}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {result.ok ? (
          <BoardTable
            board={result.data}
            caption={t("table.caption", {
              kind: t(`kinds.${selection.kind.kind}`),
              period: periodLabel,
            })}
          />
        ) : (
          <Notice
            icon={<Sprite id="icon_lock" scale={3} />}
            text={t("unreachable.text")}
            title={t("unreachable.title")}
          />
        )}

        <p className="flex flex-wrap items-center gap-2 border-panel-edge border-t-2 px-4 py-3 text-muted text-sm">
          <span className="inline-flex items-center border-2 border-panel-edge bg-void px-2 py-0.5 font-pixel text-muted text-sm shadow-px">
            {t("liveLabel")}
          </span>
          <span>{t("liveNote")}</span>
        </p>
      </PixelPanel>
    </div>
  );
}

function SegmentLink({
  active,
  query,
  children,
}: {
  active: boolean;
  query: Query;
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        aria-current={active ? "page" : undefined}
        className={[
          "inline-flex min-h-11 items-center px-3 font-pixel text-base transition-colors",
          active ? "bg-gold text-outline" : "text-soft hover:text-gold",
        ].join(" ")}
        href={{ pathname: "/leaderboards", query }}
      >
        {children}
      </Link>
    </li>
  );
}

function Notice({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      {icon}
      <p className="font-pixel text-gold text-xl">{title}</p>
      <p className="max-w-md text-soft">{text}</p>
    </div>
  );
}

function BoardTable({
  board,
  caption,
}: {
  board: LeaderboardResponse;
  caption: string;
}) {
  const t = useTranslations("leaderboards");
  if (board.entries.length === 0) {
    return (
      <Notice
        icon={<Sprite id="campfire_6f" scale={2} />}
        text={t("empty.text")}
        title={t("empty.title")}
      />
    );
  }
  const isGuild = board.kind === "guild";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="font-pixel text-muted text-sm">
          <tr>
            <th
              className="px-2 py-3 text-right font-medium sm:px-4"
              scope="col"
            >
              {t("table.rank")}
            </th>
            <th className="px-2 py-3 font-medium sm:px-4" scope="col">
              {isGuild ? t("table.guild") : t("table.player")}
            </th>
            <th
              className="px-2 py-3 text-right font-medium sm:px-4"
              scope="col"
            >
              <span className="inline-flex items-center gap-1.5">
                <Sprite id="skull_icon" scale={1} />
                {t("table.room")}
              </span>
            </th>
            <th
              className="px-2 py-3 text-right font-medium sm:px-4"
              scope="col"
            >
              <span className="inline-flex items-center gap-1.5">
                <Sprite id="clock_icon" scale={1} />
                {t("table.time")}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {board.entries.map((entry) => (
            <BoardRow entry={entry} isGuild={isGuild} key={entry.id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardRow({
  entry,
  isGuild,
}: {
  entry: LeaderboardEntry;
  isGuild: boolean;
}) {
  const t = useTranslations("leaderboards");
  const format = useFormatter();
  const date = format.dateTime(new Date(entry.achievedAt), {
    dateStyle: "medium",
  });
  return (
    <tr
      className={`border-panel-edge border-t ${
        entry.rank === 1 ? "bg-gold/10" : "hover:bg-panel/60"
      }`}
    >
      <td className="px-2 py-3 text-right align-middle sm:px-4">
        <RankMedal
          label={t("table.rankLabel", { rank: entry.rank })}
          rank={entry.rank}
        />
      </td>
      <td className="px-2 py-3 align-middle sm:px-4">
        <div className="flex flex-col">
          {isGuild && entry.tag ? (
            <Link
              className="inline-flex flex-wrap items-center gap-x-2 font-bold text-text hover:text-gold"
              href={`/guilds/${encodeURIComponent(entry.tag)}`}
            >
              <span className="font-medium font-pixel text-gold">
                [{entry.tag}]
              </span>
              <span>{entry.name}</span>
            </Link>
          ) : (
            <span className="font-bold text-text">{entry.name}</span>
          )}
          <span className="flex flex-wrap items-center gap-x-2 text-muted text-sm">
            {isGuild ? (
              <span>
                {t("table.membersCount", { count: entry.memberCount ?? 0 })}
              </span>
            ) : entry.tag ? (
              <Link
                aria-label={t("table.guildLink", { tag: entry.tag })}
                className="font-pixel text-gold hover:text-flame-core"
                href={`/guilds/${encodeURIComponent(entry.tag)}`}
              >
                [{entry.tag}]
              </Link>
            ) : null}
            <span>{date}</span>
          </span>
        </div>
      </td>
      <td className="px-2 py-3 text-right align-middle font-pixel text-gold text-xl sm:px-4">
        {entry.roomReached}
      </td>
      <td className="px-2 py-3 text-right align-middle font-pixel text-lg text-soft sm:px-4">
        {formatDuration(entry.durationSeconds)}
      </td>
    </tr>
  );
}
