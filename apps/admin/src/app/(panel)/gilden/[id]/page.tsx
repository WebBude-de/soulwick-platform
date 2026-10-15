import {
  type AdminGuildDetail,
  type AdminPlayerNoteList,
  type AdminRunList,
  type GuildMember,
  MAX_GUILD_MEMBERS,
} from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  disbandGuild,
  removeGuildMember,
  renameGuild,
  resetInviteCode,
  transferGuild,
} from "@/app/actions";
import { DangerAction } from "@/components/danger-action";
import { PixelIcon } from "@/components/pixel-icon";
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

export const metadata: Metadata = { title: "Gilde" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GuildDetailPage({ params, searchParams }: Props) {
  const [{ id }, query, me] = await Promise.all([
    params,
    searchParams,
    getMe(),
  ]);
  const result = await api<AdminGuildDetail>(
    `/admin/guilds/${encodeURIComponent(id)}`
  );
  if (!result.ok && result.status === 404) {
    notFound();
  }
  if (!result.ok) {
    return <ErrorBox message={result.message} />;
  }
  const g = result.data;
  const active = !g.disbandedAt;
  const [runs, noteResults] = await Promise.all([
    api<AdminRunList>(`/admin/runs?guildId=${g.id}&limit=20`),
    // Moderation notes live on the players (P-023); one call per member (at most 30).
    Promise.all(
      g.members.map((m) =>
        api<AdminPlayerNoteList>(
          `/admin/players/${encodeURIComponent(m.playerId)}/notes`
        )
      )
    ),
  ]);
  const notes = new Map(
    g.members.map((m, i) => [m.playerId, noteResults[i]] as const)
  );
  // Older API builds without notes answer 404 for every member: hide the column then.
  const showNotes = noteResults.some((r) => r.ok || r.status !== 404);
  const notedMembers = g.members.filter((m) => {
    const r = notes.get(m.playerId);
    return r?.ok && r.data.items.length > 0;
  });

  const facts = [
    {
      label: "Gegründet",
      value: <span className="font-data">{formatDateTime(g.createdAt)}</span>,
    },
    ...(g.disbandedAt
      ? [
          {
            label: "Aufgelöst",
            value: (
              <span className="font-data">{formatDateTime(g.disbandedAt)}</span>
            ),
          },
        ]
      : []),
    {
      label: "Mitglieder",
      value: (
        <span className="font-data">
          {g.memberCount} / {MAX_GUILD_MEMBERS}
        </span>
      ),
    },
    { label: "Gründer", value: g.founderName ?? "–" },
    ...(active
      ? [
          {
            label: "Einladungscode",
            value: <span className="font-data text-soft">{g.inviteCode}</span>,
          },
        ]
      : []),
    ...(g.progress
      ? [
          {
            label: "Gildenkasse",
            value: (
              <span className="inline-flex items-center gap-2">
                <PixelIcon name="gold" />
                <span className="font-data">{g.progress.treasury}</span> Gold
                <span className="text-muted">
                  (Version{" "}
                  <span className="font-data">{g.progress.version}</span>)
                </span>
              </span>
            ),
          },
          {
            label: "Schmiede",
            value:
              Object.keys(g.progress.forgeLevels).length === 0
                ? "–"
                : Object.entries(g.progress.forgeLevels)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", "),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageTitle
        sub={
          <>
            <Link className="link" href="/gilden">
              ← Gilden
            </Link>
            <span className="mx-2">·</span>
            ID <span className="font-data text-soft">{g.id}</span>
          </>
        }
      >
        [{g.tag}] {g.name}
        {active ? (
          <Chip tone="active">aktiv</Chip>
        ) : (
          <Chip tone="muted">aufgelöst</Chip>
        )}
      </PageTitle>
      <Flash params={query} />

      <Section title="Gilde">
        <DetailList items={facts} />

        {active ? (
          <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-4">
            <form
              action={renameGuild.bind(null, g.id)}
              className="flex flex-wrap items-end gap-3"
            >
              <label>
                <span className="field-label">Name</span>
                <input
                  className="input w-64 max-w-full"
                  defaultValue={g.name}
                  maxLength={32}
                  minLength={3}
                  name="name"
                />
              </label>
              <label>
                <span className="field-label">Kürzel</span>
                <input
                  className="input w-24 font-data"
                  defaultValue={g.tag}
                  maxLength={5}
                  minLength={2}
                  name="tag"
                />
              </label>
              <button className="btn" type="submit">
                Umbenennen
              </button>
            </form>
            <form action={resetInviteCode.bind(null, g.id)}>
              <button className="btn" type="submit">
                Einladungscode zurücksetzen
              </button>
            </form>
          </div>
        ) : null}
      </Section>

      <Section flush title="Mitglieder">
        <div className="overflow-x-auto border-line border-t-2">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rolle</th>
                <th>Beigetreten</th>
                {showNotes ? <th className="text-right">Notizen</th> : null}
                {active ? <th>Aktionen</th> : null}
              </tr>
            </thead>
            <tbody>
              {g.members.map((m) => (
                <tr key={m.playerId}>
                  <td>
                    <Link
                      className="link font-semibold"
                      href={`/spieler/${m.playerId}`}
                    >
                      {m.name}
                    </Link>
                  </td>
                  <td>{GUILD_ROLE_LABEL[m.role]}</td>
                  <td className="whitespace-nowrap font-data text-muted">
                    {formatDateTime(m.joinedAt)}
                  </td>
                  {showNotes ? (
                    <td className="text-right">
                      <NoteCount
                        playerId={m.playerId}
                        result={notes.get(m.playerId)}
                      />
                    </td>
                  ) : null}
                  {active ? (
                    <td>
                      <div className="flex flex-col items-start gap-2">
                        {m.role === "founder" ? null : (
                          <DangerAction
                            action={transferGuild.bind(
                              null,
                              g.id,
                              m.playerId,
                              m.name
                            )}
                            description={
                              <p>
                                „{m.name}“ wird Gründer und leitet die Gilde;
                                die bisherige Leitung wird Offizier.
                              </p>
                            }
                            reason={{
                              label: "Grund",
                              placeholder:
                                "z. B. Gründer inaktiv, Bitte der Gilde",
                            }}
                            small
                            submitLabel="Gildenleitung übertragen"
                            trigger="Leitung übertragen…"
                          />
                        )}
                        <DangerAction
                          action={removeGuildMember.bind(
                            null,
                            g.id,
                            m.playerId,
                            m.name
                          )}
                          description={
                            <p>
                              „{m.name}“ verlässt die Gilde.
                              {m.role === "founder"
                                ? " Die Gründerrolle geht an ein anderes Mitglied."
                                : ""}
                              {g.memberCount <= 1
                                ? " Als letztes Mitglied wird die Gilde damit aufgelöst."
                                : ""}
                            </p>
                          }
                          small
                          submitLabel="Mitglied entfernen"
                          trigger="Entfernen…"
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {g.members.length === 0 ? (
                <EmptyRow colSpan={3 + (active ? 1 : 0) + (showNotes ? 1 : 0)}>
                  Keine Mitglieder.
                </EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>

      {showNotes ? <MemberNotes members={notedMembers} notes={notes} /> : null}

      <Section flush title="Gilden-Runs">
        {runs.ok ? (
          <div className="overflow-x-auto border-line border-t-2">
            <RunTable
              canDelete={isAdmin(me)}
              returnTo={`/gilden/${g.id}`}
              runs={runs.data.items}
            />
          </div>
        ) : (
          <div className="px-4 sm:px-5">
            <ErrorBox message={runs.message} />
          </div>
        )}
      </Section>

      {active && isAdmin(me) ? (
        <Section title="Gilde auflösen" tone="danger">
          <DangerAction
            action={disbandGuild.bind(null, g.id, g.tag)}
            confirmText={g.tag}
            description={
              <p>
                Alle Mitglieder werden entfernt, Name und Kürzel werden wieder
                frei. Runs bleiben erhalten. Das lässt sich nicht rückgängig
                machen.
              </p>
            }
            submitLabel="Gilde endgültig auflösen"
            trigger="Auflösen…"
          />
        </Section>
      ) : null}
    </>
  );
}

type NoteResult = ApiResult<AdminPlayerNoteList> | undefined;

/** Note count of a member, linked to the notes on the player page. */
function NoteCount({
  playerId,
  result,
}: {
  playerId: string;
  result: NoteResult;
}) {
  if (!result?.ok) {
    return (
      <span className="text-muted" title={result?.message}>
        ?
      </span>
    );
  }
  const count = result.data.items.length;
  return count === 0 ? (
    <span className="text-muted">–</span>
  ) : (
    <Link className="link font-data" href={`/spieler/${playerId}#notizen`}>
      {count}
    </Link>
  );
}

/** Latest moderation notes of all members, newest first (read only; edit on the player page). */
function MemberNotes({
  members,
  notes,
}: {
  members: GuildMember[];
  notes: Map<string, NoteResult>;
}) {
  const LATEST = 10;
  const rows = members
    .flatMap((m) => {
      const r = notes.get(m.playerId);
      return r?.ok ? r.data.items.map((note) => ({ member: m, note })) : [];
    })
    .sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
  return (
    <Section flush title="Notizen zu Mitgliedern">
      <p className="mb-3 px-4 text-muted text-sm sm:px-5">
        Interne Moderations-Notizen der Mitglieder, neueste zuerst
        {rows.length > LATEST
          ? ` (die letzten ${LATEST} von ${rows.length})`
          : ""}
        . Schreiben und löschen auf der Spielerseite.
      </p>
      <div className="overflow-x-auto border-line border-t-2">
        <table className="table">
          <thead>
            <tr>
              <th>Spieler</th>
              <th>Notiz</th>
              <th>Wann</th>
              <th>Von</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LATEST).map(({ member, note }) => (
              <tr key={note.id}>
                <td className="whitespace-nowrap">
                  <Link
                    className="link font-semibold"
                    href={`/spieler/${member.playerId}#notizen`}
                  >
                    {member.name}
                  </Link>
                </td>
                <td className="wrap-break-word max-w-xl whitespace-pre-wrap">
                  {note.text}
                </td>
                <td className="whitespace-nowrap font-data text-muted">
                  {formatDateTime(note.createdAt)}
                </td>
                <td className="break-all text-muted">
                  {note.authorEmail ?? "(gelöschter Zugang)"}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <EmptyRow colSpan={4}>Keine Notizen zu Mitgliedern.</EmptyRow>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
