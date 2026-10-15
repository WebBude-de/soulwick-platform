import type { AdminDailyStats, AdminDailyStatsDay } from "@soulwick/contracts";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BarTable, ColumnChart } from "@/components/charts";
import {
  ErrorBox,
  FilterBar,
  Notice,
  PageTitle,
  Section,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  formatDateTime,
  formatDay,
  formatDuration,
  formatNumber,
  param,
} from "@/lib/format";

export const metadata: Metadata = { title: "Statistik" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RANGES = [7, 30, 90] as const;
const DEFAULT_RANGE = 30;

type SeriesKey = "runs" | "activePlayers" | "newPlayers";

const SERIES: { key: SeriesKey; title: string; unit: [string, string] }[] = [
  { key: "runs", title: "Runs pro Tag", unit: ["Run", "Runs"] },
  {
    key: "activePlayers",
    title: "Aktive Spieler pro Tag",
    unit: ["Spieler", "Spieler"],
  },
  {
    key: "newPlayers",
    title: "Neue Spieler pro Tag",
    unit: ["Spieler", "Spieler"],
  },
];

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <span className="font-bold font-pixel text-[32px] text-text leading-none">
        {value}
      </span>
      <span>
        <span className="block font-bold">{label}</span>
        {hint ? <span className="block text-muted text-xs">{hint}</span> : null}
      </span>
    </div>
  );
}

function seriesChart(
  series: AdminDailyStatsDay[],
  key: SeriesKey,
  title: string,
  [one, many]: [string, string]
) {
  const sum = series.reduce((acc, d) => acc + d[key], 0);
  const peak = series.reduce<AdminDailyStatsDay | undefined>(
    (best, d) => (best === undefined || d[key] > best[key] ? d : best),
    undefined
  );
  const unit = (n: number) => `${n} ${n === 1 ? one : many}`;
  return (
    <ColumnChart
      data={series.map((d) => ({
        key: d.date,
        label: formatDay(d.date),
        value: d[key],
        title: `${formatDay(d.date)}: ${unit(d[key])}`,
      }))}
      key={key}
      summary={
        peak && peak[key] > 0
          ? `Summe ${sum} · Spitze ${peak[key]} am ${formatDay(peak.date)}`
          : `Summe ${sum}`
      }
      title={title}
    />
  );
}

const bucketLabel = (min: number, max: number | null) =>
  max === null ? `${min}+` : `${min}–${max}`;

const duration = (seconds: number | null) =>
  seconds === null ? "–" : formatDuration(Math.round(seconds));

export default async function StatsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const days =
    RANGES.find((r) => String(r) === param(params, "tage")) ?? DEFAULT_RANGE;
  const result = await api<AdminDailyStats>(`/admin/stats/daily?days=${days}`);

  return (
    <>
      <PageTitle
        icon="stats"
        sub="Nur zusammengefasste Zahlen, keine Spielerlisten. Tage in UTC; Raum- und Dauerwerte ohne gemeldete Runs. Aktiv heißt: hat an einem Run teilgenommen."
      >
        Statistik
      </PageTitle>
      <FilterBar
        items={RANGES.map((r) => ({
          href: `/statistik?tage=${r}`,
          label: `${r} Tage`,
          current: r === days,
        }))}
        label="Zeitraum wählen"
      />

      {result.ok ? (
        <StatsBody stats={result.data} />
      ) : result.status === 404 ? (
        <Notice title="Noch keine Tagesstatistik">
          <p>
            Diese API-Version liefert <code>/admin/stats/daily</code> noch
            nicht. Nach dem Update der API erscheinen hier die Diagramme.
          </p>
        </Notice>
      ) : (
        <ErrorBox message={result.message} />
      )}
    </>
  );
}

function StatsBody({ stats }: { stats: AdminDailyStats }) {
  const { totals } = stats;
  return (
    <>
      <p className="mb-4 text-muted text-sm">
        Zeitraum{" "}
        <span className="font-data text-soft">{formatDay(stats.from)}</span> bis{" "}
        <span className="font-data text-soft">{formatDay(stats.to)}</span> ·
        Stand{" "}
        <span className="font-data text-soft">
          {formatDateTime(stats.generatedAt)}
        </span>
      </p>

      <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-5">
        <Figure
          hint={
            totals.flaggedRuns > 0
              ? `davon ${totals.flaggedRuns} gemeldet`
              : "keine gemeldet"
          }
          label="Runs"
          value={totals.runs}
        />
        <Figure
          hint="mit mindestens einem Run"
          label="Aktive Spieler"
          value={totals.activePlayers}
        />
        <Figure label="Neue Spieler" value={totals.newPlayers} />
        <Figure
          label="Ø erreichter Raum"
          value={formatNumber(stats.averageRoomReached, 1)}
        />
        <Figure
          hint={`Median ${duration(stats.medianDurationSeconds)}`}
          label="Ø Dauer"
          value={duration(stats.averageDurationSeconds)}
        />
        <Figure
          hint={`Schnell ${totals.runsByMode.quick} · Gilde ${totals.runsByMode.guild}`}
          label="Solo-Runs"
          value={totals.runsByMode.solo}
        />
      </div>

      <div className="mb-8 grid gap-6">
        {SERIES.map((s) => seriesChart(stats.series, s.key, s.title, s.unit))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section flush title="Erreichter Raum">
          <p className="mb-3 px-4 text-muted text-sm sm:px-5">
            Runs je Raumbereich (ohne gemeldete).
          </p>
          <div className="overflow-x-auto border-line border-t-2">
            <BarTable
              caption="Runs je erreichtem Raumbereich"
              data={stats.roomReached.map((b) => ({
                key: `${b.min}`,
                label: bucketLabel(b.min, b.max),
                value: b.runs,
              }))}
              labelHeader="Raum"
              valueHeader="Runs"
            />
          </div>
        </Section>

        <details className="card self-start">
          <summary className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <span className="font-bold font-pixel text-[20px] text-text">
              Werte als Tabelle
            </span>
            <span className="link text-sm">ein-/ausblenden</span>
          </summary>
          <div className="overflow-x-auto border-line border-t-2">
            <table className="table">
              <caption className="sr-only">Tageswerte im Zeitraum</caption>
              <thead>
                <tr>
                  <th>Tag</th>
                  <th className="text-right">Runs</th>
                  <th className="text-right">Aktive Spieler</th>
                  <th className="text-right">Neue Spieler</th>
                </tr>
              </thead>
              <tbody>
                {stats.series.map((d) => (
                  <tr key={d.date}>
                    <td className="font-data">{formatDay(d.date)}</td>
                    <td className="text-right font-data">{d.runs}</td>
                    <td className="text-right font-data">{d.activePlayers}</td>
                    <td className="text-right font-data">{d.newPlayers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  );
}
