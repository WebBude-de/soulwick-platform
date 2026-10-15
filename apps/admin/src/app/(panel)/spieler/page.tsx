import type { AdminPlayerList } from "@soulwick/contracts";
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

export const metadata: Metadata = { title: "Spieler" };
const LIMIT = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Guild tags of a player (several guilds, D-147) on one line; all tags in the tooltip. */
function GuildTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-muted">–</span>;
  }
  const all = tags.map((t) => `[${t}]`).join(" ");
  return (
    <span className="cell-truncate max-w-48 font-data" title={all}>
      {all}
    </span>
  );
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const q = param(params, "q") ?? "";
  const page = Math.max(1, Number(param(params, "seite") ?? 1) || 1);
  const offset = (page - 1) * LIMIT;
  const query = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    ...(q ? { q } : {}),
  });
  const result = await api<AdminPlayerList>(`/admin/players?${query}`);

  return (
    <>
      <PageTitle
        icon="players"
        sub="Suche nach Name, Spieler-ID oder Steam-ID."
      >
        Spieler
      </PageTitle>
      <Flash params={params} />
      <search>
        <form action="/spieler" className="mb-6 flex flex-wrap items-end gap-3">
          <label className="w-full max-w-md">
            <span className="sr-only">Spieler suchen</span>
            <input
              className="input w-full"
              defaultValue={q}
              name="q"
              placeholder="Name, ID oder Steam-ID"
              type="search"
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Suchen
          </button>
          {q ? (
            <Link className="btn" href="/spieler">
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
                `/spieler?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(n) })}`
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
                <th>Name</th>
                <th>Status</th>
                <th>Gilden</th>
                <th>Konto</th>
                <th>Zuletzt gesehen</th>
                <th>Erstellt</th>
              </tr>
            </thead>
            <tbody>
              {result.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Truncate href={`/spieler/${p.id}`} max="max-w-64">
                      {p.name}
                    </Truncate>
                  </td>
                  <td>
                    {p.banned ? (
                      <Chip tone="danger">gesperrt</Chip>
                    ) : (
                      <Chip tone="active">aktiv</Chip>
                    )}
                  </td>
                  <td>
                    <GuildTags
                      tags={p.guildTags ?? (p.guildTag ? [p.guildTag] : [])}
                    />
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {p.steamId ? (
                      <>
                        Steam <span className="font-data">{p.steamId}</span>
                      </>
                    ) : p.hasDeviceId ? (
                      "Gastkonto (Gerät)"
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>
                    <When iso={p.lastSeenAt} />
                  </td>
                  <td>
                    <When className="text-muted" iso={p.createdAt} />
                  </td>
                </tr>
              ))}
              {result.data.items.length === 0 ? (
                <EmptyRow colSpan={6}>Keine Spieler gefunden.</EmptyRow>
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
