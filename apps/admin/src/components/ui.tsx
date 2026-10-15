import Link from "next/link";
import type { ReactNode } from "react";
import { type IconName, PixelIcon } from "./pixel-icon";

export function PageTitle({
  children,
  sub,
  icon,
  actions,
}: {
  children: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-4xl space-y-2">
        <h1 className="flex flex-wrap items-center gap-3 text-[28px] text-gold sm:text-[32px]">
          {icon ? <PixelIcon name={icon} scale={2} /> : null}
          {children}
        </h1>
        {sub ? <div className="text-muted text-sm">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

type FlashTone = "ok" | "note" | "error";

function FlashBox({
  tone,
  children,
}: {
  tone: FlashTone;
  children: ReactNode;
}) {
  const label = { ok: "Erledigt", note: "Hinweis", error: "Fehler" }[tone];
  return (
    <div
      className={`flash flash-${tone} mb-6`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "ok" ? <PixelIcon className="mt-0.5" name="done" /> : null}
      {tone === "note" ? <PixelIcon className="mt-0.5" name="info" /> : null}
      <p>
        <span className="mr-2 font-data text-muted uppercase tracking-wider">
          {label}
        </span>
        {children}
      </p>
    </div>
  );
}

/** Shows ?ok=… / ?hinweis=… / ?fehler=… messages set by server actions. */
export function Flash({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const ok = typeof params.ok === "string" ? params.ok : null;
  const note = typeof params.hinweis === "string" ? params.hinweis : null;
  const error = typeof params.fehler === "string" ? params.fehler : null;
  if (error) {
    return <FlashBox tone="error">{error}</FlashBox>;
  }
  if (note) {
    return <FlashBox tone="note">{note}</FlashBox>;
  }
  if (ok) {
    return <FlashBox tone="ok">{ok}</FlashBox>;
  }
  return null;
}

/** Calm, persistent hint box (not an error), e.g. missing configuration. */
export function Notice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flash flash-note mb-6">
      <PixelIcon className="mt-0.5" name="info" />
      <div className="space-y-1 text-sm">
        <p className="font-bold text-text">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
  actions,
  tone,
  flush = false,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** `danger` marks a section that only holds a destructive action. */
  tone?: "danger";
  /** No inner padding below the title (for tables that run edge to edge). */
  flush?: boolean;
}) {
  return (
    <section
      className={`card mb-6 ${tone === "danger" ? "card-danger" : ""} ${flush ? "pt-4" : "p-4 sm:p-5"}`}
    >
      <div
        className={`mb-3 flex flex-wrap items-center justify-between gap-3 ${flush ? "px-4 sm:px-5" : ""}`}
      >
        <h2 className="text-[20px] text-text">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export type ChipTone = "active" | "danger" | "flagged" | "muted";

/** Status chip: aktiv (mech), gesperrt (danger), markiert (effect), offen/fehlt (muted). */
export function Chip({
  tone = "muted",
  title,
  children,
}: {
  tone?: ChipTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Card around a table; the table runs edge to edge, the pager sits below. */
export function TableCard({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="card mb-6">
      <div className="overflow-x-auto">{children}</div>
      {footer}
    </div>
  );
}

export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td className="py-4 text-muted" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}

/** Segmented filter links (no client JS); the current one is marked with aria-current. */
export function FilterBar({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="mb-6 flex flex-wrap gap-3">
      {items.map((item) => (
        <Link
          aria-current={item.current ? "page" : undefined}
          className="btn btn-sm"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pager({
  total,
  limit,
  offset,
  href,
}: {
  total: number;
  limit: number;
  offset: number;
  href: (page: number) => string;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) {
    return null;
  }
  return (
    <nav
      aria-label="Seiten"
      className="flex flex-wrap items-center gap-3 border-line border-t-2 px-4 py-3 text-muted text-sm"
    >
      {page > 1 ? (
        <Link className="btn btn-sm" href={href(page - 1)}>
          ← Zurück
        </Link>
      ) : null}
      <span>
        Seite <span className="font-data text-text">{page}</span> von{" "}
        <span className="font-data text-text">{pages}</span> (
        <span className="font-data">{total}</span> Einträge)
      </span>
      {page < pages ? (
        <Link className="btn btn-sm" href={href(page + 1)}>
          Weiter →
        </Link>
      ) : null}
    </nav>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flash flash-error mb-6" role="alert">
      <p>
        <span className="mr-2 font-data text-muted uppercase tracking-wider">
          Fehler
        </span>
        {message}
      </p>
    </div>
  );
}

/** Label + value rows for detail pages. */
export function DetailList({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map((item) => (
        <div className="contents" key={item.label}>
          <dt className="text-muted">{item.label}</dt>
          <dd className="wrap-break-word min-w-0">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
