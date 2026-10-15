import type { AdminGuildList } from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Chip,
  EmptyRow,
  ErrorBox,
  Flash,
  Pager,
  PageTitle,
  TableCard,
  Truncate,
  When,
} from "@/components/ui";
import { api } from "@/lib/api";
import { param } from "@/lib/format";

export const metadata: Metadata = { title: "Gilden" };
const LIMIT = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** URL slug → API `status` (P-023). */
const STATUS = [
  { slug: "aktiv", label: "Aktive", api: "active" },
  { slug: "aufgeloest", label: "Aufgelöste", api: "disbanded" },
  { slug: "alle", label: "Alle", api: "all" },
] as const;

export default async function GuildsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const q = param(params, "q") ?? "";
  // `aufgeloest=1` is the old checkbox link (all guilds).
  const statusSlug =
    param(params, "aufgeloest") === "1" ? "alle" : param(params, "status");
  const status = STATUS.find((st) => st.slug === statusSlug) ?? STATUS[0];
  const page = Math.max(1, Number(param(params, "seite") ?? 1) || 1);
  const offset = (page - 1) * LIMIT;
  const query = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    status: status.api,
    // Older API builds only know `includeDisbanded`.
    includeDisbanded: String(status.api !== "active"),
    ...(q ? { q } : {}),
  });
  const result = await api<AdminGuildList>(`/admin/guilds?${query}`);

  return (
    <>
      <PageTitle icon="guilds" sub="Suche nach Name, Kürzel oder Gilden-ID.">
        Gilden
      </PageTitle>
      <Flash params={params} />
      <search>
        <form
          action="/gilden"
          className="mb-6 flex flex-wrap items-center gap-3"
        >
          <label className="w-full max-w-md">
            <span className="sr-only">Gilden suchen</span>
            <input
              className="input w-full"
              defaultValue={q}
              name="q"
              placeholder="Name, Kürzel oder ID"
              type="search"
            />
          </label>
          <label className="flex items-center gap-2 text-muted text-sm">
            Status
            <select className="input" defaultValue={status.slug} name="status">
              {STATUS.map((st) => (
                <option key={st.slug} value={st.slug}>
                  {st.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" type="submit">
            Suchen
          </button>
          {q || status.slug !== "aktiv" ? (
            <Link className="btn" href="/gilden">
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
                `/gilden?${new URLSearchParams({ ...(q ? { q } : {}), status: status.slug, seite: String(n) })}`
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
                <th>Kürzel</th>
                <th>Name</th>
                <th>Status</th>
                <th className="text-right">Mitglieder</th>
                <th>Gründer</th>
                <th>Gegründet</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap font-data text-soft">
                    [{g.tag}]
                  </td>
                  <td>
                    <Truncate href={`/gilden/${g.id}`} max="max-w-72">
                      {g.name}
                    </Truncate>
                  </td>
                  <td>
                    {g.disbandedAt ? (
                      <Chip tone="muted">aufgelöst</Chip>
                    ) : (
                      <Chip tone="active">aktiv</Chip>
                    )}
                  </td>
                  <td className="text-right font-data">{g.memberCount}</td>
                  <td className="text-muted">
                    {g.founderName ? (
                      <Truncate max="max-w-56">{g.founderName}</Truncate>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>
                    <When className="text-muted" iso={g.createdAt} />
                  </td>
                </tr>
              ))}
              {result.data.items.length === 0 ? (
                <EmptyRow colSpan={6}>Keine Gilden gefunden.</EmptyRow>
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
