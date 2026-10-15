import type {
  AdminBugReportList,
  AdminBugReportListItem,
  BugReportStatus,
} from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Chip,
  EmptyRow,
  ErrorBox,
  Flash,
  Notice,
  PageTitle,
  RowActions,
  TableCard,
  Truncate,
  When,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  BUG_CATEGORY_LABEL,
  BUG_STATUS_LABEL,
  BUG_STATUS_TONE,
  PLATFORM_LABEL,
  param,
} from "@/lib/format";

export const metadata: Metadata = { title: "Bug-Meldungen" };
const LIMIT = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Status tabs; German slugs in the URL, API values in the query. "Neu" is the work queue. */
const TABS: { slug: string; status: BugReportStatus | null }[] = [
  { slug: "neu", status: "new" },
  { slug: "gesehen", status: "seen" },
  { slug: "erledigt", status: "done" },
  { slug: "abgelehnt", status: "wont_fix" },
  { slug: "alle", status: null },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listHref(tab: string, player?: string, cursor?: string) {
  const query = new URLSearchParams({ status: tab });
  if (player) {
    query.set("spieler", player);
  }
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `/bug-meldungen?${query}`;
}

function Row({ report }: { report: AdminBugReportListItem }) {
  const href = `/bug-meldungen/${report.id}`;
  const marks = report.markCount + report.strokeCount;
  return (
    <tr>
      <td>
        <When iso={report.createdAt} />
      </td>
      <td>
        <span className="flex min-w-0 items-center gap-2">
          <Truncate className="min-w-0" href={href} max="max-w-full">
            {report.notePreview || "(ohne Text)"}
          </Truncate>
          {marks > 0 ? (
            <span
              className="whitespace-nowrap font-data text-muted text-xs"
              title={`${report.markCount} Markierungen, ${report.strokeCount} Striche`}
            >
              ▢ {marks}
            </span>
          ) : null}
        </span>
      </td>
      <td>
        {report.location ? (
          <Truncate max="max-w-full">{report.location}</Truncate>
        ) : (
          <span className="text-muted">–</span>
        )}
      </td>
      <td>
        <Truncate className="text-soft" max="max-w-full">
          {report.categories.length > 0
            ? report.categories
                .map((c) => BUG_CATEGORY_LABEL[c] ?? c)
                .join(", ")
            : "–"}
        </Truncate>
      </td>
      <td>
        <Truncate href={`/spieler/${report.playerId}`} max="max-w-full">
          {report.playerName}
        </Truncate>
      </td>
      <td className="whitespace-nowrap">
        {PLATFORM_LABEL[report.platform] ?? report.platform}{" "}
        <span className="font-data text-muted">{report.gameVersion}</span>
      </td>
      <td>
        <Chip
          title={
            report.handledAt
              ? `bearbeitet ${report.handledByEmail ? `von ${report.handledByEmail}` : ""}`
              : undefined
          }
          tone={BUG_STATUS_TONE[report.status] ?? "muted"}
        >
          {BUG_STATUS_LABEL[report.status] ?? report.status}
        </Chip>
      </td>
      <td>
        <RowActions>
          <Link className="btn btn-sm" href={href}>
            Öffnen
          </Link>
        </RowActions>
      </td>
    </tr>
  );
}

export default async function BugReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const tab = TABS.find((t) => t.slug === param(params, "status")) ?? TABS[0];
  const playerParam = param(params, "spieler");
  const player =
    playerParam && UUID.test(playerParam) ? playerParam : undefined;
  const cursor = param(params, "cursor")?.slice(0, 200);
  const query = new URLSearchParams({ limit: String(LIMIT) });
  if (tab?.status) {
    query.set("status", tab.status);
  }
  if (player) {
    query.set("playerId", player);
  }
  if (cursor) {
    query.set("cursor", cursor);
  }
  const result = await api<AdminBugReportList>(`/admin/bug-reports?${query}`);
  const slug = tab?.slug ?? "neu";
  const counts = result.ok ? result.data.counts : null;
  const playerName =
    player && result.ok
      ? result.data.items.find((r) => r.playerId === player)?.playerName
      : undefined;

  return (
    <>
      <PageTitle
        icon="info"
        sub="Meldungen aus dem Spiel (F9): Bildschirmfoto mit Markierungen, Notiz und Spielstand. Status setzen dürfen alle; Löschen nur Admins. Meldungen werden nach 90 Tagen automatisch gelöscht."
      >
        Bug-Meldungen
      </PageTitle>
      <Flash params={params} />

      {player ? (
        <Notice title="Gefiltert nach Spieler">
          <p>
            Nur Meldungen von{" "}
            <Link className="link" href={`/spieler/${player}`}>
              {playerName ?? "diesem Spieler"}
            </Link>
            .{" "}
            <Link className="link" href={listHref(slug)}>
              Filter aufheben
            </Link>
          </p>
        </Notice>
      ) : null}

      <nav
        aria-label="Nach Status filtern"
        className="mb-6 flex flex-wrap gap-3"
      >
        {TABS.map((t) => {
          const count = counts
            ? t.status
              ? counts[t.status]
              : counts.new + counts.seen + counts.done + counts.wont_fix
            : null;
          return (
            <Link
              aria-current={t.slug === slug ? "page" : undefined}
              className="chip chip-link"
              href={listHref(t.slug, player)}
              key={t.slug}
            >
              {t.status ? BUG_STATUS_LABEL[t.status] : "Alle"}
              {count === null ? null : (
                <span className="font-data text-gold">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {result.ok ? (
        <TableCard
          footer={
            cursor || result.data.nextCursor ? (
              <nav
                aria-label="Seiten"
                className="flex flex-wrap items-center gap-3 border-line border-t-2 px-4 py-3 text-muted text-sm"
              >
                {cursor ? (
                  <Link className="btn btn-sm" href={listHref(slug, player)}>
                    ← Zum Anfang
                  </Link>
                ) : null}
                <span>
                  <span className="font-data">{result.data.total}</span>{" "}
                  Meldungen, je Seite {LIMIT}
                </span>
                {result.data.nextCursor ? (
                  <Link
                    className="btn btn-sm"
                    href={listHref(slug, player, result.data.nextCursor)}
                  >
                    Ältere →
                  </Link>
                ) : null}
              </nav>
            ) : null
          }
        >
          <table className="table min-w-5xl table-fixed">
            <colgroup>
              <col className="w-32" />
              {/* The note takes the free width; the place a share of it. */}
              <col />
              <col className="w-[14%]" />
              <col className="w-32" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-40" />
              <col className="w-24" />
            </colgroup>
            <thead>
              <tr>
                <th>Gemeldet</th>
                <th>Meldung</th>
                <th>Ort</th>
                <th>Kategorien</th>
                <th>Spieler</th>
                <th>Plattform</th>
                <th>Status</th>
                <th className="text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((report) => (
                <Row key={report.id} report={report} />
              ))}
              {result.data.items.length === 0 ? (
                <EmptyRow colSpan={8}>
                  {tab?.status === "new"
                    ? "Keine neuen Meldungen."
                    : "Keine Meldungen in dieser Ansicht."}
                </EmptyRow>
              ) : null}
            </tbody>
          </table>
        </TableCard>
      ) : result.status === 404 && result.error === "not_found" ? (
        <Notice title="Noch nicht verfügbar">
          <p>Diese API kennt noch keine Bug-Meldungen (älterer Stand).</p>
        </Notice>
      ) : (
        <ErrorBox message={result.message} />
      )}
    </>
  );
}
