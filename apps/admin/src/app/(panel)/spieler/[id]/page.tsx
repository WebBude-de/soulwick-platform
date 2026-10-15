import type {
  AdminPlayerDetail,
  AdminPlayerNoteList,
  AdminSelf,
} from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addPlayerNote,
  banPlayer,
  deletePlayer,
  deletePlayerNote,
  renamePlayer,
  unbanPlayer,
} from "@/app/actions";
import { DangerAction, RowDangerAction } from "@/components/danger-action";
import { RunTable } from "@/components/run-table";
import {
  Chip,
  DetailList,
  EmptyRow,
  ErrorBox,
  Flash,
  PageTitle,
  Section,
  Truncate,
  When,
} from "@/components/ui";
import { type ApiResult, api, getMe, isAdmin } from "@/lib/api";
import {
  APPEARANCE_COLOR_SLOTS,
  CHARACTER_LABEL,
  formatDateTime,
  GUILD_ROLE_LABEL,
} from "@/lib/format";

export const metadata: Metadata = { title: "Spieler" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlayerDetailPage({
  params,
  searchParams,
}: Props) {
  const [{ id }, query, me] = await Promise.all([
    params,
    searchParams,
    getMe(),
  ]);
  const result = await api<AdminPlayerDetail>(
    `/admin/players/${encodeURIComponent(id)}`
  );
  if (!result.ok && result.status === 404) {
    notFound();
  }
  if (!result.ok) {
    return <ErrorBox message={result.message} />;
  }
  const p = result.data;
  // Several guilds per player (D-147), oldest membership first; older API builds only send `guild`.
  const guilds = p.guilds ?? (p.guild ? [p.guild] : []);
  const notes = await api<AdminPlayerNoteList>(
    `/admin/players/${encodeURIComponent(p.id)}/notes`
  );

  return (
    <>
      <PageTitle
        sub={
          <>
            <Link className="link" href="/spieler">
              ← Spieler
            </Link>
            <span className="mx-2">·</span>
            ID <span className="font-data text-soft">{p.id}</span>
            <span className="mx-2">·</span>
            <Link className="link" href={`/protokoll?id=${p.id}`}>
              Protokoll zu diesem Spieler
            </Link>
            <span className="mx-2">·</span>
            <Link
              className="link"
              href={`/bug-meldungen?status=alle&spieler=${p.id}`}
            >
              Bug-Meldungen
            </Link>
          </>
        }
      >
        {p.name}
        {p.banned ? (
          <Chip tone="danger">gesperrt</Chip>
        ) : (
          <Chip tone="active">aktiv</Chip>
        )}
      </PageTitle>
      <Flash params={query} />

      <Section title="Profil">
        <DetailList
          items={[
            {
              label: "Konto",
              value: p.steamId ? (
                <>
                  Steam-ID <span className="font-data">{p.steamId}</span>
                </>
              ) : p.hasDeviceId ? (
                "Gastkonto (Gerät)"
              ) : (
                "–"
              ),
            },
            {
              label: guilds.length > 1 ? "Gilden" : "Gilde",
              value:
                guilds.length === 0 ? (
                  "–"
                ) : (
                  <ul className="space-y-1">
                    {guilds.map((g) => (
                      <li
                        className="flex min-w-0 items-center gap-2"
                        key={g.id}
                      >
                        <Link
                          className="link flex min-w-0 items-center gap-1.5"
                          href={`/gilden/${g.id}`}
                          title={`[${g.tag}] ${g.name}`}
                        >
                          <span className="font-data">[{g.tag}]</span>
                          <span className="cell-truncate max-w-72">
                            {g.name}
                          </span>
                        </Link>
                        <span className="whitespace-nowrap text-muted">
                          · {GUILD_ROLE_LABEL[g.role] ?? g.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                ),
            },
            // Older API builds do not send `appearance` at all: leave the row out.
            ...(p.appearance === undefined
              ? []
              : [
                  {
                    label: "Figur",
                    value: <Appearance appearance={p.appearance} />,
                  },
                ]),
            {
              label: "Erstellt",
              value: (
                <span className="font-data">{formatDateTime(p.createdAt)}</span>
              ),
            },
            {
              label: "Zuletzt gesehen",
              value: (
                <span className="font-data">
                  {formatDateTime(p.lastSeenAt)}
                </span>
              ),
            },
            ...(p.runsTotal === undefined
              ? []
              : [
                  {
                    label: "Runs gesamt",
                    value: (
                      <span className="font-data">
                        {p.runsTotal}
                        {p.runsTotal > p.recentRuns.length ? (
                          <span className="font-body text-muted">
                            {" "}
                            (unten die letzten {p.recentRuns.length})
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                ]),
            ...(p.noteCount === undefined
              ? []
              : [
                  {
                    label: "Notizen",
                    value: (
                      <a className="link font-data" href="#notizen">
                        {p.noteCount}
                      </a>
                    ),
                  },
                ]),
          ]}
        />
        <form
          action={renamePlayer.bind(null, p.id)}
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          <label>
            <span className="field-label">Name ändern</span>
            <input
              className="input w-64 max-w-full"
              defaultValue={p.name}
              maxLength={24}
              minLength={2}
              name="name"
              required
            />
          </label>
          <button className="btn" type="submit">
            Umbenennen
          </button>
        </form>
        {p.nameHistory ? <NameHistory entries={p.nameHistory} /> : null}
      </Section>

      <Section
        actions={
          p.banned ? (
            <form action={unbanPlayer.bind(null, p.id, p.name)}>
              <button className="btn btn-sm" type="submit">
                Sperre aufheben
              </button>
            </form>
          ) : null
        }
        flush
        title="Sperren"
      >
        <div className="px-4 pb-4 sm:px-5">
          <DangerAction
            action={banPlayer.bind(null, p.id, p.name)}
            description={
              <p>
                Gesperrte Spieler können sich nicht anmelden und keine Runs
                einreichen. Der Grund steht im Protokoll.
              </p>
            }
            reason={{
              label: "Grund",
              placeholder: "z. B. Cheating, beleidigender Name",
            }}
            submitLabel={`„${p.name}“ sperren`}
            trigger={p.banned ? "Erneut sperren…" : "Sperren…"}
          >
            <label className="block">
              <span className="field-label">Dauer</span>
              <select className="input" defaultValue="7" name="duration">
                <option value="1">1 Tag</option>
                <option value="7">7 Tage</option>
                <option value="30">30 Tage</option>
                <option value="permanent">dauerhaft</option>
              </select>
            </label>
          </DangerAction>
        </div>
        <div className="overflow-x-auto border-line border-t-2">
          <table className="table">
            <thead>
              <tr>
                <th>Grund</th>
                <th>Status</th>
                <th>Seit</th>
                <th>Bis</th>
                <th>Von</th>
              </tr>
            </thead>
            <tbody>
              {p.bans.map((b) => (
                <tr key={b.id}>
                  <td className="wrap-break-word">{b.reason}</td>
                  <td>
                    {b.active ? (
                      <Chip tone="danger">aktiv</Chip>
                    ) : b.revokedAt ? (
                      <Chip
                        title={`aufgehoben ${formatDateTime(b.revokedAt)}${b.revokedBy ? ` von ${b.revokedBy}` : ""}`}
                        tone="muted"
                      >
                        aufgehoben
                      </Chip>
                    ) : (
                      <Chip tone="muted">abgelaufen</Chip>
                    )}
                  </td>
                  <td>
                    <When iso={b.createdAt} />
                  </td>
                  <td>
                    {b.expiresAt ? (
                      <When iso={b.expiresAt} />
                    ) : (
                      <span className="whitespace-nowrap">dauerhaft</span>
                    )}
                  </td>
                  <td className="text-muted">
                    <Truncate max="max-w-56">{b.createdBy ?? "–"}</Truncate>
                  </td>
                </tr>
              ))}
              {p.bans.length === 0 ? (
                <EmptyRow colSpan={5}>Keine Sperren.</EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>

      <Notes me={me} notes={notes} playerId={p.id} />

      <Section flush title="Letzte Runs">
        <div className="overflow-x-auto border-line border-t-2">
          <RunTable
            canDelete={isAdmin(me)}
            returnTo={`/spieler/${p.id}`}
            runs={p.recentRuns}
          />
        </div>
      </Section>

      {isAdmin(me) ? (
        <Section title="Konto löschen" tone="danger">
          <DangerAction
            action={deletePlayer.bind(null, p.id, p.name)}
            confirmText={p.name}
            description={
              <>
                <p>
                  Löscht das Konto endgültig: Identitäten, Sperren und
                  Run-Teilnahmen.{" "}
                  {guilds.length === 0
                    ? ""
                    : guilds.length === 1
                      ? "Die Mitgliedschaft in der Gilde endet (die Gründerrolle geht weiter, als letztes Mitglied wird die Gilde aufgelöst). "
                      : `Alle ${guilds.length} Gildenmitgliedschaften enden (Gründerrollen gehen weiter, wo der Spieler letztes Mitglied ist, wird die Gilde aufgelöst). `}
                  Das lässt sich nicht rückgängig machen.
                </p>
                <p className="text-muted">
                  Spieler löschen ihr Konto selbst (im Spiel oder auf der
                  Website mit dem Einmal-Code). Hier nur löschen, wenn das nicht
                  geht, z. B. auf Anfrage über die Support-Adresse ohne Zugang
                  zum Spiel. Die Löschung steht im Protokoll und ohne Namen im{" "}
                  <Link className="link" href="/loeschungen">
                    Löschprotokoll
                  </Link>
                  .
                </p>
              </>
            }
            reason={{
              label: "Notiz fürs Protokoll",
              name: "note",
              placeholder: "z. B. Anfrage über Support, kein Zugang zum Spiel",
              required: false,
            }}
            submitLabel="Konto endgültig löschen"
            trigger="Konto löschen…"
          />
        </Section>
      ) : null}
    </>
  );
}

/**
 * The account's character (P-034): figure name plus the four palette indexes. The panel has no
 * palette, so the colours show as numbered swatches; null = the game's default character.
 */
function Appearance({
  appearance,
}: {
  appearance: AdminPlayerDetail["appearance"];
}) {
  if (!appearance) {
    return <span className="text-muted">Standardfigur (nichts gewählt)</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-semibold">
        {CHARACTER_LABEL[appearance.character] ?? appearance.character}
      </span>
      <span className="flex flex-wrap items-center gap-3 text-muted text-xs">
        {APPEARANCE_COLOR_SLOTS.map((slot) => {
          const index = appearance.colors[slot.key];
          return (
            <span
              className="flex items-center gap-1.5"
              key={slot.key}
              title={
                index === undefined
                  ? `${slot.label}: nicht gewählt`
                  : `${slot.label}: Farbe ${index} (Palette 0–7)`
              }
            >
              {slot.label}
              <span className="swatch font-data">{index ?? "–"}</span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Recent name changes, newest first (own changes in the game and renames in the panel). */
function NameHistory({
  entries,
}: {
  entries: NonNullable<AdminPlayerDetail["nameHistory"]>;
}) {
  return (
    <div className="mt-5 border-line border-t-2 pt-4">
      <h3 className="mb-2 font-bold text-sm">Namensverlauf</h3>
      {entries.length === 0 ? (
        <p className="text-muted text-sm">
          Keine Namenswechsel in den letzten 90 Tagen.
        </p>
      ) : (
        <ol className="space-y-1 text-sm">
          {entries.slice(0, 20).map((entry) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
              key={`${entry.changedAt}-${entry.newName}`}
            >
              <When className="text-muted" iso={entry.changedAt} />
              <span className="flex min-w-0 items-center gap-2">
                <Truncate className="text-muted" max="max-w-56">
                  {entry.oldName}
                </Truncate>
                <span aria-hidden="true" className="text-muted">
                  →
                </span>
                <span className="sr-only">zu</span>
                <Truncate className="font-semibold" max="max-w-56">
                  {entry.newName}
                </Truncate>
              </span>
              {entry.byAdmin ? <Chip tone="muted">durch Admin</Chip> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Internal moderation notes (never shown to the player). Delete: admin or the author. */
function Notes({
  playerId,
  notes,
  me,
}: {
  playerId: string;
  notes: ApiResult<AdminPlayerNoteList>;
  me: AdminSelf;
}) {
  if (!notes.ok && notes.status === 404) {
    // The player exists (the page loaded it): an older API without notes. Leave it out.
    return null;
  }
  return (
    <section className="card mb-6 p-4 sm:p-5" id="notizen">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[20px] text-text">Notizen</h2>
        <span className="text-muted text-sm">
          Nur für das Moderationsteam, der Spieler sieht sie nie.
        </span>
      </div>
      {notes.ok ? (
        <ul className="mb-4 space-y-3">
          {notes.data.items.map((note) => (
            <li
              className="rounded border-2 border-line bg-bg-deep p-3"
              key={note.id}
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-muted text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <When iso={note.createdAt} />
                  <span aria-hidden="true">·</span>
                  <Truncate max="max-w-72">
                    {note.authorEmail ?? "(gelöschter Zugang)"}
                  </Truncate>
                </span>
                {isAdmin(me) || note.authorId === me.id ? (
                  <RowDangerAction
                    action={deletePlayerNote.bind(null, playerId, note.id)}
                    description={
                      <p className="wrap-break-word line-clamp-3">
                        {note.text}
                      </p>
                    }
                    icon="trash"
                    iconOnly
                    id={`note-delete-${note.id}`}
                    label="Notiz löschen"
                    submitLabel="Notiz löschen"
                  />
                ) : null}
              </div>
              <p className="wrap-break-word whitespace-pre-wrap">{note.text}</p>
            </li>
          ))}
          {notes.data.items.length === 0 ? (
            <li className="text-muted">Noch keine Notizen.</li>
          ) : null}
        </ul>
      ) : (
        <ErrorBox message={notes.message} />
      )}
      <form action={addPlayerNote.bind(null, playerId)} className="space-y-3">
        <label className="block">
          <span className="field-label">Neue Notiz</span>
          <textarea
            className="input min-h-24 w-full"
            maxLength={2000}
            name="text"
            placeholder="z. B. Verwarnung wegen Namen per Mail, Rückfrage offen"
            required
          />
        </label>
        <button className="btn" type="submit">
          Notiz speichern
        </button>
      </form>
    </section>
  );
}
