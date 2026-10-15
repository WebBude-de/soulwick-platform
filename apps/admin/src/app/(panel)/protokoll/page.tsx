import { AuditAction, type AuditList } from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Chip,
  EmptyRow,
  ErrorBox,
  Pager,
  PageTitle,
  TableCard,
  Truncate,
  When,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_TARGET_LABEL,
  auditDetails,
  auditTone,
  param,
  shortId,
} from "@/lib/format";

export const metadata: Metadata = { title: "Protokoll" };
const LIMIT = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function targetHref(
  type: string,
  id: string | null,
  action: string
): string | null {
  // Deleted players have no page any more.
  if (!id || action === "player.delete") {
    return null;
  }
  if (type === "player") {
    return `/spieler/${id}`;
  }
  if (type === "guild") {
    return `/gilden/${id}`;
  }
  return null;
}

/** Action groups for the `actionPrefix` filter (P-023). */
const AREAS = [
  { value: "player.", label: "Spieler" },
  { value: "guild.", label: "Gilden" },
  { value: "run.", label: "Runs" },
  { value: "relay.", label: "Live-Räume" },
  { value: "admin.", label: "Admins" },
] as const;

const TARGET_TYPES = [
  "player",
  "guild",
  "run",
  "relay_room",
  "admin_user",
] as const;

/**
 * Filterable actions: only those of a current area. Rows of retired actions (`legal.*`,
 * `deletion_request.resolve`) are still listed with their legacy label, just not filterable.
 */
const FILTER_ACTIONS = AuditAction.options.filter((a) =>
  AREAS.some((area) => a.startsWith(area.value))
);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A bare UUID in the details (ban, note, player id): shortened, full id as tooltip. */
const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[\w-]{1,64}$/;

/** Reads and validates the filter params (German names in the URL, API names in the query). */
function readFilters(params: Record<string, string | string[] | undefined>) {
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = param(params, key)?.trim();
    return v && ok(v) ? v : undefined;
  };
  return {
    aktion: pick("aktion", (v) => FILTER_ACTIONS.some((a) => a === v)),
    bereich: pick("bereich", (v) => AREAS.some((a) => a.value === v)),
    ziel: pick("ziel", (v) => TARGET_TYPES.some((t) => t === v)),
    id: pick("id", (v) => ID.test(v)),
    von: pick("von", (v) => DAY.test(v)),
    bis: pick("bis", (v) => DAY.test(v)),
  };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(param(params, "seite") ?? 1) || 1);
  const offset = (page - 1) * LIMIT;
  const f = readFilters(params);
  const active = Object.fromEntries(
    Object.entries(f).filter((e): e is [string, string] => e[1] !== undefined)
  );
  const filtered = Object.keys(active).length > 0;
  const query = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    ...(f.aktion ? { action: f.aktion } : {}),
    ...(f.bereich ? { actionPrefix: f.bereich } : {}),
    ...(f.ziel ? { targetType: f.ziel } : {}),
    ...(f.id ? { targetId: f.id } : {}),
    ...(f.von ? { from: f.von } : {}),
    ...(f.bis ? { to: f.bis } : {}),
  });
  const result = await api<AuditList>(`/admin/audit?${query}`);

  return (
    <>
      <PageTitle
        icon="audit"
        sub="Jede Änderung durch Admins und Moderatoren wird hier protokolliert."
      >
        Protokoll
      </PageTitle>
      <search>
        <form
          action="/protokoll"
          className="mb-6 flex flex-wrap items-end gap-3"
        >
          <label>
            <span className="field-label">Von (Tag)</span>
            <input
              className="input"
              defaultValue={f.von}
              name="von"
              type="date"
            />
          </label>
          <label>
            <span className="field-label">Bis (Tag)</span>
            <input
              className="input"
              defaultValue={f.bis}
              name="bis"
              type="date"
            />
          </label>
          <label>
            <span className="field-label">Bereich</span>
            <select
              className="input"
              defaultValue={f.bereich ?? ""}
              name="bereich"
            >
              <option value="">Alle Bereiche</option>
              {AREAS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Aktion</span>
            <select
              className="input"
              defaultValue={f.aktion ?? ""}
              name="aktion"
            >
              <option value="">Alle Aktionen</option>
              {FILTER_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {AUDIT_ACTION_LABEL[a] ?? a}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Ziel</span>
            <select className="input" defaultValue={f.ziel ?? ""} name="ziel">
              <option value="">Alle Ziele</option>
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AUDIT_TARGET_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Ziel-ID</span>
            <input
              className="input w-44 font-data"
              defaultValue={f.id}
              name="id"
              placeholder="UUID oder Raumcode"
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Filtern
          </button>
          {filtered ? (
            <Link className="btn" href="/protokoll">
              Zurücksetzen
            </Link>
          ) : null}
        </form>
      </search>
      {result.ok ? (
        <TableCard
          footer={
            <Pager
              href={(n) =>
                `/protokoll?${new URLSearchParams({ ...active, seite: String(n) })}`
              }
              limit={LIMIT}
              offset={offset}
              total={result.data.total}
            />
          }
        >
          <table className="table">
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Aktion</th>
                <th>Wer</th>
                <th>Ziel</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((e) => {
                const href = targetHref(e.targetType, e.targetId, e.action);
                const target = (
                  <>
                    {AUDIT_TARGET_LABEL[e.targetType] ?? e.targetType}{" "}
                    <span className="font-data">{shortId(e.targetId)}</span>
                  </>
                );
                const details = auditDetails(e.details);
                return (
                  <tr key={e.id}>
                    <td>
                      <When iso={e.createdAt} />
                    </td>
                    <td>
                      <Chip tone={auditTone(e.action)}>
                        {AUDIT_ACTION_LABEL[e.action] ?? e.action}
                      </Chip>
                    </td>
                    <td className="text-muted">
                      <Truncate max="max-w-52">
                        {e.adminEmail ?? "(gelöschter Zugang)"}
                      </Truncate>
                    </td>
                    <td className="whitespace-nowrap" title={e.targetId ?? ""}>
                      {href ? (
                        <Link className="link" href={href}>
                          {target}
                        </Link>
                      ) : (
                        target
                      )}
                    </td>
                    <td className="text-xs">
                      {details.length === 0 ? (
                        <span className="text-muted">–</span>
                      ) : (
                        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {details.map((d) => (
                            <li className="wrap-anywhere" key={d.key}>
                              {d.label ? (
                                <span className="text-muted">{d.label}: </span>
                              ) : null}
                              {UUID_VALUE.test(d.value) ? (
                                <span className="font-data" title={d.value}>
                                  {shortId(d.value)}
                                </span>
                              ) : (
                                d.value
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
              {result.data.items.length === 0 ? (
                <EmptyRow colSpan={5}>Keine Einträge.</EmptyRow>
              ) : null}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <ErrorBox message={result.message} />
      )}
    </>
  );
}
