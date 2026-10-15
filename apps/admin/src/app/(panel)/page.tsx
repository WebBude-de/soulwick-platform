import type {
  AdminAccountDeletionList,
  AdminDailyStats,
  AdminRunList,
  AdminStats,
  AuditList,
} from "@soulwick/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { SparkColumns } from "@/components/charts";
import { type IconName, PixelIcon } from "@/components/pixel-icon";
import { Chip, ErrorBox, PageTitle } from "@/components/ui";
import { type ApiResult, api } from "@/lib/api";
import {
  AUDIT_ACTION_LABEL,
  auditTone,
  DELETION_CHANNEL_LABEL,
  flagReasonText,
  formatDateTime,
  formatDay,
} from "@/lib/format";

/**
 * One tile per figure from GET /admin/stats. A new figure in the contract is one more entry
 * here. Figures the API does not send show "–", optional ones (newer API builds) are hidden.
 */
interface StatTile {
  hint?: string | ((stats: AdminStats) => string | undefined);
  href: string;
  icon: IconName;
  key: string;
  label: string;
  /** Hide the tile when the API does not send the figure (fields added in "Admin-API v2"). */
  optional?: boolean;
  value: (stats: AdminStats) => number | undefined;
  /** Needs attention: orange frame and a "prüfen" chip. */
  warn?: (value: number) => boolean;
}

/** Things moderators act on or keep an eye on. */
const MODERATION_TILES: StatTile[] = [
  {
    key: "players",
    label: "Spieler",
    icon: "players",
    href: "/spieler",
    value: (s) => s.players,
  },
  {
    key: "activeBans",
    label: "Aktive Sperren",
    icon: "lock",
    href: "/spieler",
    value: (s) => s.activeBans,
    hint: "Spieler mit laufender Sperre",
  },
  {
    key: "guilds",
    label: "Gilden",
    icon: "guilds",
    href: "/gilden",
    value: (s) => s.guilds,
    hint: "ohne aufgelöste",
  },
  {
    key: "flaggedRuns",
    label: "Gemeldete Runs",
    icon: "runs",
    href: "/runs?filter=gemeldet",
    value: (s) => s.flaggedRuns,
    warn: (n) => n > 0,
    hint: "zählen nicht in Ranglisten",
  },
  {
    // Deletions run automatically (P-026): a figure to watch, never a warning.
    key: "deletions7d",
    label: "Löschungen",
    icon: "deletion",
    href: "/loeschungen",
    value: (s) => s.deletions7d,
    hint: "letzte 7 Tage, alle Wege",
    optional: true,
  },
];

/** Activity of the last days (optional fields, P-023). */
const ACTIVITY_TILES: StatTile[] = [
  {
    key: "newPlayers7d",
    label: "Neue Spieler",
    icon: "players",
    href: "/spieler",
    value: (s) => s.newPlayers7d,
    hint: "letzte 7 Tage",
    optional: true,
  },
  {
    key: "activePlayers7d",
    label: "Aktive Spieler",
    icon: "overview",
    href: "/spieler",
    value: (s) => s.activePlayers7d,
    hint: "zuletzt gesehen in 7 Tagen",
    optional: true,
  },
  {
    key: "runs24h",
    label: "Runs heute",
    icon: "audit",
    href: "/runs?filter=alle",
    value: (s) => s.runs24h,
    hint: "letzte 24 Stunden",
    optional: true,
  },
  {
    key: "runs7d",
    label: "Runs der Woche",
    icon: "runs",
    href: "/runs?filter=alle",
    value: (s) => s.runs7d,
    hint: "letzte 7 Tage",
    optional: true,
  },
  {
    key: "runsTotal",
    label: "Runs gesamt",
    icon: "stats",
    href: "/statistik",
    value: (s) => s.runsTotal,
    hint: (s) =>
      s.runsByMode
        ? `Solo ${s.runsByMode.solo} · Schnell ${s.runsByMode.quick} · Gilde ${s.runsByMode.guild}`
        : "seit Start",
    optional: true,
  },
  {
    key: "activeGuilds7d",
    label: "Aktive Gilden",
    icon: "guilds",
    href: "/gilden",
    value: (s) => s.activeGuilds7d,
    hint: "Mitglied in 7 Tagen gesehen",
    optional: true,
  },
];

const RECENT = 5;
/** Days in the overview series (the Statistik page offers 7, 30 and 90). */
const SERIES_DAYS = 14;

const SERIES: {
  key: "runs" | "activePlayers" | "newPlayers";
  title: string;
  unit: [string, string];
  /** Figure next to the title: the window total from the API (`totals`). */
  total: [string, (t: AdminDailyStats["totals"]) => number];
}[] = [
  {
    key: "runs",
    title: "Runs",
    unit: ["Run", "Runs"],
    total: ["Summe", (t) => t.runs],
  },
  {
    key: "activePlayers",
    title: "Aktive Spieler",
    unit: ["Spieler", "Spieler"],
    // Daily actives do not add up; the API counts distinct players of the window.
    total: ["verschiedene", (t) => t.activePlayers],
  },
  {
    key: "newPlayers",
    title: "Neue Spieler",
    unit: ["Spieler", "Spieler"],
    total: ["Summe", (t) => t.newPlayers],
  },
];

/** Daily series of the last 14 days (UTC days, today so far), one small chart per figure. */
function DailySeries({ result }: { result: ApiResult<AdminDailyStats> }) {
  if (!result.ok && result.status === 404) {
    // Older API without /admin/stats/daily: leave the row out.
    return null;
  }
  return (
    <section aria-labelledby="tagesreihe" className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="eyebrow" id="tagesreihe">
          Letzte {SERIES_DAYS} Tage
        </h2>
        <Link className="link text-sm" href="/statistik">
          Mehr in der Statistik →
        </Link>
      </div>
      {result.ok ? (
        <div className="grid gap-4 md:grid-cols-3">
          {SERIES.map((s) => {
            const days = result.data.series;
            const [totalLabel, totalOf] = s.total;
            const total = totalOf(result.data.totals);
            const unit = (n: number) =>
              `${n} ${n === 1 ? s.unit[0] : s.unit[1]}`;
            const last = days.at(-1);
            return (
              <figure className="card p-4" key={s.key}>
                <figcaption className="mb-3 flex items-baseline justify-between gap-3">
                  <span className="font-bold text-sm">{s.title} pro Tag</span>
                  <span className="text-muted text-xs">
                    {totalLabel}{" "}
                    <span className="font-data text-text">{total}</span>
                  </span>
                </figcaption>
                <SparkColumns
                  data={days.map((d) => ({
                    key: d.date,
                    label: formatDay(d.date),
                    value: d[s.key],
                    title: `${formatDay(d.date)}${d === last ? " (heute bisher)" : ""}: ${unit(d[s.key])}`,
                  }))}
                  label={`${s.title} pro Tag, letzte ${SERIES_DAYS} Tage, ${totalLabel} ${total}`}
                />
                <div className="mt-1 flex justify-between font-data text-muted text-xs">
                  <span>{days[0] ? formatDay(days[0].date) : ""}</span>
                  <span>heute</span>
                </div>
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="card px-4 py-3 text-muted text-sm">
          Tagesreihe nicht geladen: {result.message}
        </p>
      )}
    </section>
  );
}

function Tile({ tile, stats }: { tile: StatTile; stats: AdminStats }) {
  const value = tile.value(stats);
  const warn = value !== undefined && (tile.warn?.(value) ?? false);
  return (
    <Link
      className={`card flex flex-col gap-2 p-3.5 ${warn ? "card-warn" : ""}`}
      href={tile.href}
    >
      <span className="flex min-w-0 items-center gap-2 font-bold text-sm">
        <span className="flex size-6 flex-none items-center justify-center">
          <PixelIcon name={tile.icon} />
        </span>
        {tile.label}
      </span>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`font-bold font-pixel text-[32px] leading-none ${warn ? "text-effect" : "text-text"}`}
        >
          {value ?? "–"}
        </span>
        {warn ? <Chip tone="flagged">prüfen</Chip> : null}
      </span>
      <span className="block text-muted text-xs">
        {value === undefined
          ? "Von dieser API nicht geliefert"
          : typeof tile.hint === "function"
            ? tile.hint(stats)
            : tile.hint}
      </span>
    </Link>
  );
}

/** A titled row of tiles; hidden when none of its (optional) figures is delivered. */
function TileGroup({
  title,
  tiles,
  stats,
}: {
  title: string;
  tiles: StatTile[];
  stats: AdminStats;
}) {
  const visible = tiles.filter(
    (tile) => !tile.optional || tile.value(stats) !== undefined
  );
  if (visible.length === 0) {
    return null;
  }
  return (
    <section aria-label={title} className="mb-8">
      <h2 className="eyebrow mb-3">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {visible.map((tile) => (
          <Tile key={tile.key} stats={stats} tile={tile} />
        ))}
      </div>
    </section>
  );
}

function RecentCard<T>({
  title,
  href,
  result,
  empty,
  children,
}: {
  title: string;
  href: string;
  result: ApiResult<{ items: T[]; total: number }>;
  empty: string;
  children: (item: T) => ReactNode;
}) {
  return (
    <section className="card flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="text-[20px] text-text">
          {title}
          {result.ok ? (
            <span className="ml-2 font-data text-base text-muted">
              ({result.data.total})
            </span>
          ) : null}
        </h2>
        <Link className="link shrink-0 text-sm" href={href}>
          Alle ansehen →
        </Link>
      </div>
      {result.ok ? (
        <ul className="flex-1 border-line border-t-2 text-sm">
          {result.data.items.map((item) => children(item))}
          {result.data.items.length === 0 ? (
            <li className="px-4 py-3 text-muted">{empty}</li>
          ) : null}
        </ul>
      ) : (
        <p className="border-line border-t-2 px-4 py-3 text-muted text-sm">
          Nicht geladen: {result.message}
        </p>
      )}
    </section>
  );
}

const rowClass = "space-y-1 px-4 py-2.5 even:bg-bg-deep";

export default async function OverviewPage() {
  const [stats, daily, flagged, deletions, audit] = await Promise.all([
    api<AdminStats>("/admin/stats"),
    api<AdminDailyStats>(`/admin/stats/daily?days=${SERIES_DAYS}`),
    api<AdminRunList>(`/admin/runs?flagged=true&limit=${RECENT}&offset=0`),
    api<AdminAccountDeletionList>(
      `/admin/account-deletions?limit=${RECENT}&offset=0`
    ),
    api<AuditList>(`/admin/audit?limit=${RECENT + 1}&offset=0`),
  ]);

  return (
    <>
      <PageTitle
        icon="overview"
        sub={
          <>
            Stand{" "}
            <span className="font-data text-soft">
              {formatDateTime(new Date().toISOString())}
            </span>{" "}
            – neu laden für aktuelle Zahlen.
          </>
        }
      >
        Übersicht
      </PageTitle>

      {stats.ok ? (
        <>
          <TileGroup
            stats={stats.data}
            tiles={MODERATION_TILES}
            title="Moderation"
          />
          <TileGroup
            stats={stats.data}
            tiles={ACTIVITY_TILES}
            title="Aktivität"
          />
        </>
      ) : (
        <ErrorBox message={stats.message} />
      )}

      <DailySeries result={daily} />

      <div className="divider mb-8 opacity-70" />

      <div className="grid gap-6 xl:grid-cols-3">
        <RecentCard
          empty="Keine gemeldeten Runs."
          href="/runs?filter=gemeldet"
          result={flagged}
          title="Gemeldete Runs"
        >
          {(run) => (
            <li className={rowClass} key={run.id}>
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <span className="font-semibold">
                  {run.participants.map((p) => p.name).join(", ") ||
                    "(gelöscht)"}
                </span>
                <span className="font-data text-muted text-xs">
                  {formatDateTime(run.createdAt)}
                </span>
              </div>
              <div className="text-muted text-xs">
                Raum <span className="font-data">{run.roomReached}</span> ·{" "}
                {flagReasonText(run.flagReason)}
              </div>
            </li>
          )}
        </RecentCard>

        <RecentCard
          empty="Noch keine Löschungen."
          href="/loeschungen"
          result={deletions}
          title="Letzte Löschungen"
        >
          {(deletion) => (
            <li className={rowClass} key={deletion.id}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <Chip tone="muted">
                  {DELETION_CHANNEL_LABEL[deletion.channel] ?? deletion.channel}
                </Chip>
                <span className="font-data text-muted text-xs">
                  {formatDateTime(deletion.deletedAt)}
                </span>
              </div>
              {deletion.wasBanned ? (
                <div className="text-muted text-xs">war gesperrt</div>
              ) : null}
            </li>
          )}
        </RecentCard>

        <RecentCard
          empty="Noch keine Einträge."
          href="/protokoll"
          result={audit}
          title="Zuletzt im Protokoll"
        >
          {(entry) => (
            <li className={rowClass} key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <Chip tone={auditTone(entry.action)}>
                  {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                </Chip>
                <span className="font-data text-muted text-xs">
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              <div className="break-all text-muted text-xs">
                {entry.adminEmail ?? "(gelöschter Zugang)"}
              </div>
            </li>
          )}
        </RecentCard>
      </div>
    </>
  );
}
