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
import { DangerAction } from "@/components/danger-action";
import { RunTable } from "@/components/run-table";
import {
  Chip,
  DetailList,
  EmptyRow,
  ErrorBox,
  Flash,
  PageTitle,
  Section,
} from "@/components/ui";
import { type ApiResult, api, getMe, isAdmin } from "@/lib/api";
import { formatDateTime, GUILD_ROLE_LABEL } from "@/lib/format";

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
                "Geräte-ID (Testphase)"
              ) : (
                "–"
              ),
            },
            {
              label: "Gilde",
              value: p.guild ? (
                <>
                  <Link className="link" href={`/gilden/${p.guild.id}`}>
                    <span className="font-data">[{p.guild.tag}]</span>{" "}
                    {p.guild.name}
                  </Link>
                  <span className="text-muted">
                    {" "}
                    · {GUILD_ROLE_LABEL[p.guild.role]}
                  </span>
                </>
              ) : (
                "–"
              ),
            },
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
                  <td className="wrap-break-word max-w-md">{b.reason}</td>
                  <td>
                    {b.active ? (
                      <Chip tone="danger">aktiv</Chip>
                    ) : b.revokedAt ? (
                      <div className="space-y-1">
                        <Chip tone="muted">aufgehoben</Chip>
                        <div className="text-muted text-xs">
                          <span className="font-data">
                            {formatDateTime(b.revokedAt)}
                          </span>
                          {b.revokedBy ? ` · ${b.revokedBy}` : ""}
                        </div>
                      </div>
                    ) : (
                      <Chip tone="muted">abgelaufen</Chip>
                    )}
                  </td>
                  <td className="whitespace-nowrap font-data">
                    {formatDateTime(b.createdAt)}
                  </td>
                  <td className="whitespace-nowrap font-data">
                    {b.expiresAt ? formatDateTime(b.expiresAt) : "dauerhaft"}
                  </td>
                  <td className="break-all text-muted">{b.createdBy ?? "–"}</td>
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
                  Run-Teilnahmen. Die Gildenmitgliedschaft endet (die
                  Gründerrolle geht weiter, als letztes Mitglied wird die Gilde
                  aufgelöst). Das lässt sich nicht rückgängig machen.
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
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-muted text-xs">
                <span>
                  <span className="font-data">
                    {formatDateTime(note.createdAt)}
                  </span>{" "}
                  · {note.authorEmail ?? "(gelöschter Zugang)"}
                </span>
                {isAdmin(me) || note.authorId === me.id ? (
                  <DangerAction
                    action={deletePlayerNote.bind(null, playerId, note.id)}
                    small
                    submitLabel="Notiz löschen"
                    trigger="Löschen…"
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
