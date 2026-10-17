import {
  type AdminBugReportDetail,
  BugReportStatus,
} from "@soulwick/contracts";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteBugReport, setBugReportStatus } from "@/app/actions";
import { DangerAction } from "@/components/danger-action";
import {
  Chip,
  DetailList,
  ErrorBox,
  Flash,
  PageTitle,
  Section,
  Truncate,
  When,
} from "@/components/ui";
import { api, getMe, isAdmin } from "@/lib/api";
import {
  BUG_CATEGORY_LABEL,
  BUG_KIND_LABEL,
  BUG_KIND_TONE,
  BUG_STATUS_LABEL,
  BUG_STATUS_TONE,
  formatBytes,
  formatDateTime,
  PLATFORM_LABEL,
} from "@/lib/format";

export const metadata: Metadata = { title: "Bug-Meldung" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Context fields with their own row; every other key of `context` is listed as sent. */
const CONTEXT_LABEL: Record<string, string> = {
  location: "Ort",
  scene: "Szene",
  seed: "Seed",
  resolution: "Auflösung",
  locale: "Sprache",
};

const contextValue = (value: unknown) =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);

const RESOLUTION = /^(\d{2,5})\s*x\s*(\d{2,5})$/i;

/** "1920x1080" -> [1920, 1080] for the image box before it loads; 16:9 otherwise. */
function imageSize(context: Record<string, unknown>): [number, number] {
  const match =
    typeof context.resolution === "string"
      ? RESOLUTION.exec(context.resolution)
      : null;
  return match === null ? [1920, 1080] : [Number(match[1]), Number(match[2])];
}

/**
 * Screenshot with the marks (numbered rectangles) and freehand strokes as an SVG overlay in
 * relative coordinates. Hiding the overlay is a plain checkbox with a CSS `:has()` rule, no JS.
 */
function Screenshot({ report }: { report: AdminBugReportDetail }) {
  const [width, height] = imageSize(report.context);
  const hasOverlay = report.marks.length + report.strokes.length > 0;
  return (
    <div className="shot-view space-y-3">
      {hasOverlay ? (
        <label className="flex w-fit items-center gap-2 text-sm text-soft">
          <input className="shot-hide" type="checkbox" />
          Markierungen ausblenden
        </label>
      ) : null}
      <div className="shot">
        <Image
          alt={`Bildschirmfoto der Meldung von ${report.playerName}`}
          height={height}
          src={`/bug-meldungen/${report.id}/bild`}
          unoptimized
          width={width}
        />
        {hasOverlay ? (
          <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1 1">
            {report.marks.map((mark, i) => (
              <rect
                className="shot-mark"
                height={mark.h}
                // biome-ignore lint/suspicious/noArrayIndexKey: marks have no id; their order is fixed
                key={i}
                vectorEffect="non-scaling-stroke"
                width={mark.w}
                x={mark.x}
                y={mark.y}
              />
            ))}
            {report.strokes.map((stroke, i) => (
              <polyline
                className="shot-stroke"
                // biome-ignore lint/suspicious/noArrayIndexKey: strokes have no id; their order is fixed
                key={i}
                points={stroke.map(([x, y]) => `${x},${y}`).join(" ")}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        ) : null}
        {report.marks.map((mark, i) => (
          <span
            aria-hidden="true"
            className="shot-label"
            // biome-ignore lint/suspicious/noArrayIndexKey: marks have no id; their order is fixed
            key={i}
            style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <p className="text-muted text-xs">
        {report.imageMime.replace("image/", "").toUpperCase()},{" "}
        {formatBytes(report.imageBytes)} ·{" "}
        <a
          className="link"
          href={`/bug-meldungen/${report.id}/bild`}
          rel="noopener"
          target="_blank"
        >
          Bild in voller Größe öffnen
        </a>
      </p>
    </div>
  );
}

export default async function BugReportPage({ params, searchParams }: Props) {
  const [{ id }, query, me] = await Promise.all([
    params,
    searchParams,
    getMe(),
  ]);
  const result = await api<AdminBugReportDetail>(
    `/admin/bug-reports/${encodeURIComponent(id)}`
  );
  if (!result.ok && result.status === 404) {
    notFound();
  }
  if (!result.ok) {
    return <ErrorBox message={result.message} />;
  }
  const r = result.data;
  const otherContext = Object.entries(r.context).filter(
    ([key]) => !Object.hasOwn(CONTEXT_LABEL, key)
  );

  return (
    <>
      <PageTitle
        sub={
          <>
            <Link className="link" href="/bug-meldungen">
              ← Bug-Meldungen
            </Link>
            <span className="mx-2">·</span>
            ID <span className="font-data text-soft">{r.id}</span>
            <span className="mx-2">·</span>
            <Link className="link" href={`/protokoll?id=${r.id}`}>
              Protokoll zu dieser Meldung
            </Link>
          </>
        }
      >
        {r.kind === "idea" ? "Idee" : "Bug-Meldung"}
        <Chip tone={BUG_KIND_TONE[r.kind] ?? "danger"}>
          {BUG_KIND_LABEL[r.kind] ?? "Fehler"}
        </Chip>
        <Chip tone={BUG_STATUS_TONE[r.status] ?? "muted"}>
          {BUG_STATUS_LABEL[r.status] ?? r.status}
        </Chip>
      </PageTitle>
      <Flash params={query} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Section title="Bildschirmfoto">
          <Screenshot report={r} />
          {r.marks.length > 0 ? (
            <ol className="mt-4 space-y-1 text-sm">
              {r.marks.map((mark, i) => (
                <li
                  className="flex gap-2"
                  // biome-ignore lint/suspicious/noArrayIndexKey: marks have no id; their order is fixed
                  key={i}
                >
                  <span className="swatch font-data">{i + 1}</span>
                  <span
                    className={
                      mark.note ? "wrap-break-word min-w-0" : "text-muted"
                    }
                  >
                    {mark.note || "(ohne Notiz)"}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {r.strokes.length > 0 ? (
            <p className="mt-2 text-muted text-sm">
              Dazu {r.strokes.length}{" "}
              {r.strokes.length === 1 ? "freier Strich" : "freie Striche"}{" "}
              (gelb).
            </p>
          ) : null}
        </Section>

        <div>
          <Section title="Meldung">
            <p
              className={`wrap-break-word mb-4 whitespace-pre-wrap ${r.note ? "" : "text-muted"}`}
            >
              {r.note || "(ohne Text)"}
            </p>
            {r.categories.length > 0 ? (
              <ul aria-label="Kategorien" className="mb-4 flex flex-wrap gap-2">
                {r.categories.map((c) => (
                  <li key={c}>
                    <Chip>{BUG_CATEGORY_LABEL[c] ?? c}</Chip>
                  </li>
                ))}
              </ul>
            ) : null}
            <DetailList
              items={[
                {
                  label: "Spieler",
                  value: (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3">
                      <Truncate href={`/spieler/${r.playerId}`} max="max-w-56">
                        {r.playerName}
                      </Truncate>
                      <Link
                        className="link text-xs"
                        href={`/bug-meldungen?status=alle&spieler=${r.playerId}`}
                      >
                        alle Meldungen
                      </Link>
                    </span>
                  ),
                },
                { label: "Gemeldet", value: <When iso={r.createdAt} /> },
                ...Object.entries(CONTEXT_LABEL)
                  .filter(([key]) => r.context[key] !== undefined)
                  .map(([key, label]) => ({
                    label,
                    value: (
                      <span className={key === "location" ? "" : "font-data"}>
                        {contextValue(r.context[key])}
                      </span>
                    ),
                  })),
                {
                  label: "Spiel",
                  value: (
                    <>
                      {PLATFORM_LABEL[r.platform] ?? r.platform}{" "}
                      <span className="font-data text-muted">
                        {r.gameVersion}
                      </span>
                    </>
                  ),
                },
                {
                  label: "Bearbeitet",
                  value: r.handledAt ? (
                    <>
                      <When iso={r.handledAt} />{" "}
                      <span className="text-muted">
                        von {r.handledByEmail ?? "(gelöschter Zugang)"}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">noch nicht</span>
                  ),
                },
                {
                  label: "Gelöscht am",
                  value: (
                    <span
                      className="font-data"
                      title="Automatisch nach der Aufbewahrungsfrist"
                    >
                      {formatDateTime(r.expiresAt)}
                    </span>
                  ),
                },
              ]}
            />
            {otherContext.length > 0 ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-muted">
                  Weitere Angaben aus dem Spiel ({otherContext.length})
                </summary>
                <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
                  {otherContext.map(([key, value]) => (
                    <div className="contents" key={key}>
                      <dt className="font-data text-muted">{key}</dt>
                      <dd className="wrap-break-word min-w-0 font-data">
                        {contextValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </Section>

          <Section title="Status">
            <form action={setBugReportStatus.bind(null, r.id)}>
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Status setzen</legend>
                {BugReportStatus.options.map((status) => (
                  <button
                    aria-pressed={status === r.status}
                    className="btn btn-sm"
                    disabled={status === r.status}
                    key={status}
                    name="status"
                    type="submit"
                    value={status}
                  >
                    {BUG_STATUS_LABEL[status] ?? status}
                  </button>
                ))}
              </fieldset>
            </form>
            <p className="mt-3 text-muted text-xs">
              Jede Änderung steht im Protokoll. „Neu“ setzt die Bearbeitung
              zurück.
            </p>
          </Section>

          {isAdmin(me) ? (
            <Section title="Meldung löschen" tone="danger">
              <DangerAction
                action={deleteBugReport.bind(null, r.id)}
                description={
                  <p>
                    Löscht Meldung und Bildschirmfoto sofort statt nach der
                    Frist. Das lässt sich nicht rückgängig machen; im Protokoll
                    bleibt ein Eintrag ohne Bild und Text.
                  </p>
                }
                submitLabel="Meldung endgültig löschen"
                trigger="Löschen…"
              />
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
