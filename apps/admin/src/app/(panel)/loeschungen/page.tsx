import type {
  AccountDeletionChannel,
  AdminAccountDeletionList,
  AdminPlayerDetail,
} from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Chip,
  EmptyRow,
  ErrorBox,
  Notice,
  Pager,
  PageTitle,
  TableCard,
  Truncate,
  When,
} from "@/components/ui";
import { type ApiResult, api } from "@/lib/api";
import {
  DELETION_CHANNEL_HINT,
  DELETION_CHANNEL_LABEL,
  formatDateTime,
  param,
} from "@/lib/format";

export const metadata: Metadata = { title: "Löschprotokoll" };
const LIMIT = 50;
const PATH = "/loeschungen";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CHANNELS: AccountDeletionChannel[] = ["web_code", "in_game", "admin"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads and validates the filter params (German names in the URL, API names in the query). */
function readFilters(params: Record<string, string | string[] | undefined>) {
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = param(params, key)?.trim();
    return v && ok(v) ? v : undefined;
  };
  const rawId = param(params, "spieler")?.trim();
  return {
    von: pick("von", (v) => DAY.test(v)),
    bis: pick("bis", (v) => DAY.test(v)),
    kanal: pick("kanal", (v) => CHANNELS.some((c) => c === v)) as
      | AccountDeletionChannel
      | undefined,
    spieler: rawId && UUID.test(rawId) ? rawId.toLowerCase() : undefined,
    /** Something was typed into the player id field that is not a UUID. */
    invalidId: rawId && !UUID.test(rawId) ? rawId : undefined,
  };
}

type Filters = ReturnType<typeof readFilters>;

/** Panel URL with the given filters (empty ones left out). */
function href(f: Partial<Filters>, page = 1): string {
  const query = new URLSearchParams({
    ...(f.von ? { von: f.von } : {}),
    ...(f.bis ? { bis: f.bis } : {}),
    ...(f.kanal ? { kanal: f.kanal } : {}),
    ...(f.spieler ? { spieler: f.spieler } : {}),
    ...(page > 1 ? { seite: String(page) } : {}),
  });
  const qs = query.toString();
  return qs ? `${PATH}?${qs}` : PATH;
}

/**
 * Channel counts as chips; each chip filters by its channel ("Alle" clears it). The counts follow
 * the time range and player id, not the channel filter, so all numbers stay visible.
 */
function ChannelChips({
  counts,
  filters,
}: {
  counts: AdminAccountDeletionList["counts"];
  filters: Filters;
}) {
  const all = CHANNELS.reduce((sum, c) => sum + counts[c], 0);
  const items = [
    { key: "alle", channel: undefined, label: "Alle", count: all },
    ...CHANNELS.map((c) => ({
      key: c,
      channel: c,
      label: DELETION_CHANNEL_LABEL[c] ?? c,
      count: counts[c],
    })),
  ];
  return (
    <nav aria-label="Nach Kanal filtern" className="mb-6 flex flex-wrap gap-3">
      {items.map((item) => (
        <Link
          aria-current={item.channel === filters.kanal ? "page" : undefined}
          className="chip chip-link"
          href={href({ ...filters, kanal: item.channel })}
          key={item.key}
          title={item.channel ? DELETION_CHANNEL_HINT[item.channel] : undefined}
        >
          {item.label}
          <span className="font-data text-gold">{item.count}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * Answer for the player id search: "was this account deleted?". Without a log entry the page
 * checks whether the account still exists, so support gets a clear answer either way.
 */
function PlayerAnswer({
  playerId,
  result,
  player,
}: {
  playerId: string;
  result: AdminAccountDeletionList;
  player: ApiResult<AdminPlayerDetail> | null;
}) {
  const first = result.items[0];
  if (first) {
    return (
      <Notice title="Dieses Konto wurde gelöscht.">
        <p>
          Spieler-ID <span className="font-data">{playerId}</span>: gelöscht am{" "}
          <span className="font-data">{formatDateTime(first.deletedAt)}</span> (
          {DELETION_CHANNEL_LABEL[first.channel] ?? first.channel}
          {first.wasBanned ? ", war gesperrt" : ""}).
        </p>
      </Notice>
    );
  }
  if (player?.ok) {
    return (
      <Notice title="Kein Eintrag – das Konto besteht noch.">
        <p>
          Spieler-ID <span className="font-data">{playerId}</span> gehört zu{" "}
          <Link className="link" href={`/spieler/${player.data.id}`}>
            {player.data.name}
          </Link>
          .
        </p>
      </Notice>
    );
  }
  return (
    <Notice title="Kein Eintrag im Löschprotokoll.">
      <p>
        Zu Spieler-ID <span className="font-data">{playerId}</span> gibt es
        weder eine Löschung im gewählten Zeitraum noch ein Konto. Mögliche
        Gründe: ID falsch abgeschrieben, Konto mit einem anderen zusammengeführt
        (das ist keine Löschung) oder vor Einführung des Löschprotokolls
        gelöscht.
      </p>
    </Notice>
  );
}

export default async function DeletionLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const f = readFilters(params);
  const page = Math.max(1, Number(param(params, "seite") ?? 1) || 1);
  const offset = (page - 1) * LIMIT;
  const query = new URLSearchParams({
    limit: String(LIMIT),
    offset: String(offset),
    ...(f.von ? { from: f.von } : {}),
    ...(f.bis ? { to: f.bis } : {}),
    ...(f.kanal ? { channel: f.kanal } : {}),
    ...(f.spieler ? { playerId: f.spieler } : {}),
  });
  const result = await api<AdminAccountDeletionList>(
    `/admin/account-deletions?${query}`
  );
  // Only asked when the log has no entry for the searched id.
  const player =
    f.spieler && result.ok && result.data.total === 0
      ? await api<AdminPlayerDetail>(
          `/admin/players/${encodeURIComponent(f.spieler)}`
        )
      : null;
  const filtered = Boolean(f.von || f.bis || f.kanal || f.spieler);

  return (
    <>
      <PageTitle
        icon="deletion"
        sub={
          <>
            Löschungen laufen automatisch; hier steht nur, wann und auf welchem
            Weg – ohne Namen. Spieler löschen ihr Konto selbst (im Spiel oder
            auf der Website mit dem Einmal-Code aus dem Spiel); ohne Zugang zum
            Spiel löscht ein Admin auf der Spielerseite.
          </>
        }
      >
        Löschprotokoll
      </PageTitle>

      <search>
        <form action={PATH} className="mb-6 flex flex-wrap items-end gap-3">
          {f.kanal ? (
            <input name="kanal" type="hidden" value={f.kanal} />
          ) : null}
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
            <span className="field-label">
              Spieler-ID (wurde dieses Konto gelöscht?)
            </span>
            <input
              autoComplete="off"
              className="input w-96 max-w-full font-data"
              defaultValue={f.spieler ?? f.invalidId}
              name="spieler"
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              placeholder="UUID des Kontos"
              spellCheck={false}
              title="Spieler-ID als UUID, z. B. 3f2c…-…"
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Filtern
          </button>
          {filtered || f.invalidId ? (
            <Link className="btn" href={PATH}>
              Zurücksetzen
            </Link>
          ) : null}
        </form>
      </search>

      {f.invalidId ? (
        <ErrorBox message="Das ist keine gültige Spieler-ID (UUID) – die Suche wurde ignoriert." />
      ) : null}

      {result.ok ? (
        <>
          {f.spieler ? (
            <PlayerAnswer
              player={player}
              playerId={f.spieler}
              result={result.data}
            />
          ) : null}
          <ChannelChips counts={result.data.counts} filters={f} />
          <TableCard
            footer={
              <Pager
                href={(n) => href(f, n)}
                limit={LIMIT}
                offset={offset}
                total={result.data.total}
              />
            }
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Gelöscht am</th>
                  <th>Kanal</th>
                  <th>Sperre</th>
                  <th>Weg</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <When iso={d.deletedAt} />
                    </td>
                    <td>
                      <Chip tone="muted">
                        {DELETION_CHANNEL_LABEL[d.channel] ?? d.channel}
                      </Chip>
                    </td>
                    <td>
                      {d.wasBanned ? (
                        <Chip tone="danger">war gesperrt</Chip>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="text-muted">
                      <Truncate max="max-w-xl">
                        {DELETION_CHANNEL_HINT[d.channel] ?? "–"}
                      </Truncate>
                    </td>
                  </tr>
                ))}
                {result.data.items.length === 0 ? (
                  <EmptyRow colSpan={4}>
                    {filtered
                      ? "Keine Löschungen für diese Auswahl."
                      : "Noch keine Löschungen."}
                  </EmptyRow>
                ) : null}
              </tbody>
            </table>
          </TableCard>
        </>
      ) : (
        <ErrorBox
          message={
            result.status === 404
              ? "Die API kennt das Löschprotokoll noch nicht (Route /admin/account-deletions fehlt)."
              : result.message
          }
        />
      )}
    </>
  );
}
