import type { AdminRelayRoom, AdminRelayRoomList } from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { closeRelayRoom, kickRelayPlayer } from "@/app/actions";
import { RowDangerAction } from "@/components/danger-action";
import {
  Chip,
  ErrorBox,
  Flash,
  Notice,
  PageTitle,
  RowActions,
  Truncate,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  formatAge,
  formatDateTime,
  formatRate,
  PLATFORM_LABEL,
  ROOM_MODE_LABEL,
} from "@/lib/format";

export const metadata: Metadata = { title: "Live-Räume" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Small "label value" pair in the room's fact line. */
function Fact({
  label,
  children,
  title,
}: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className="whitespace-nowrap" title={title}>
      <span className="text-muted">{label} </span>
      <span className="font-data text-soft">{children}</span>
    </span>
  );
}

/** Mode with the owning guild: "Schnelles Spiel" or "Gilde [TAG] Name" (linked). */
function RoomMode({ room }: { room: AdminRelayRoom }) {
  const mode = ROOM_MODE_LABEL[room.mode] ?? room.mode;
  if (!room.guildId) {
    return <span className="whitespace-nowrap text-soft">{mode}</span>;
  }
  // `guildTag`/`guildName` come from the API (D-147); null when the guild no longer exists.
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="whitespace-nowrap text-soft">{mode}</span>
      {room.guildTag ? (
        <Link
          className="link flex min-w-0 items-center gap-1.5"
          href={`/gilden/${room.guildId}`}
          title={`[${room.guildTag}] ${room.guildName ?? ""}`.trim()}
        >
          <span className="font-data">[{room.guildTag}]</span>
          {room.guildName ? (
            <span className="cell-truncate max-w-48">{room.guildName}</span>
          ) : null}
        </Link>
      ) : (
        <Link
          className="link whitespace-nowrap"
          href={`/gilden/${room.guildId}`}
        >
          Zur Gilde
        </Link>
      )}
    </span>
  );
}

/** One open room: header (code, mode, status, close), facts, then one row per player. */
function RoomCard({ room, now }: { room: AdminRelayRoom; now: number }) {
  const lobbyLeft = room.expiresAt
    ? Math.max(0, Math.round((new Date(room.expiresAt).getTime() - now) / 1000))
    : null;
  return (
    <article aria-labelledby={`raum-${room.code}`} className="card">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line border-b-2 px-4 py-3">
        <h2
          className="font-data text-[18px] text-text tracking-[0.12em]"
          id={`raum-${room.code}`}
          title={`Raumcode ${room.code}`}
        >
          {room.code}
        </h2>
        <RoomMode room={room} />
        {room.started ? (
          <Chip tone="active">Run läuft</Chip>
        ) : (
          <Chip tone="muted">Lobby</Chip>
        )}
        <div className="ml-auto">
          <RowActions>
            <RowDangerAction
              action={closeRelayRoom.bind(null, room.code)}
              description={
                <p>
                  Alle {room.playerCount} Spieler verlassen den Raum
                  {room.started ? ", der laufende Run endet" : ""}. Sie sehen,
                  dass die Moderation den Raum geschlossen hat.
                </p>
              }
              icon="close"
              id={`room-close-${room.code}`}
              label="Schließen…"
              reason={{
                label: "Grund",
                placeholder: "z. B. Missbrauch, Belästigung",
              }}
              submitLabel={`Raum ${room.code} schließen`}
            />
          </RowActions>
        </div>
      </header>

      <p className="flex flex-wrap gap-x-5 gap-y-1 px-4 pt-3 pb-2 text-sm">
        <Fact
          label="Offen seit"
          title={`erstellt ${formatDateTime(room.createdAt)}`}
        >
          {formatAge(room.ageSeconds)}
        </Fact>
        <Fact label="Spieler">
          {room.playerCount} / {room.maxPlayers}
        </Fact>
        {room.started ? (
          <Fact label="Run">{room.runsStarted}</Fact>
        ) : (
          <Fact
            label="Lobby schließt in"
            title={
              room.expiresAt
                ? `um ${formatDateTime(room.expiresAt)}, wenn kein Run startet`
                : undefined
            }
          >
            {lobbyLeft === null ? "–" : formatAge(lobbyLeft)}
          </Fact>
        )}
        <Fact label="Version">{room.gameVersion}</Fact>
        <Fact
          label="Verkehr"
          title="Spielpakete zum Relay (↓) und vom Relay (↑), Mittel der letzten Sekunden"
        >
          ↓ {formatRate(room.bytesInPerSecond)} · ↑{" "}
          {formatRate(room.bytesOutPerSecond)}
        </Fact>
      </p>

      <table className="table table-fixed">
        <caption className="sr-only">Spieler in Raum {room.code}</caption>
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-26" />
          <col className="w-18" />
        </colgroup>
        <thead>
          <tr>
            <th>Spieler</th>
            <th>Plattform</th>
            <th className="text-right">Im Raum</th>
            <th className="text-right">
              <span className="sr-only">Aktionen</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {room.players.map((p) => {
            const name = p.name ?? "(Name unbekannt)";
            return (
              <tr key={p.peerId}>
                <td>
                  <span className="flex min-w-0 items-center gap-2">
                    <Truncate href={`/spieler/${p.playerId}`} max="max-w-full">
                      {name}
                    </Truncate>
                    {p.host ? <Chip tone="flagged">Host</Chip> : null}
                  </span>
                </td>
                <td className="whitespace-nowrap text-muted">
                  {PLATFORM_LABEL[p.platform] ?? p.platform}
                </td>
                <td className="whitespace-nowrap text-right font-data">
                  {formatAge(p.inRoomSeconds)}
                </td>
                <td>
                  <RowActions>
                    <RowDangerAction
                      action={kickRelayPlayer.bind(
                        null,
                        room.code,
                        p.playerId,
                        name
                      )}
                      description={
                        <p>
                          {p.host
                            ? "Der Host wird entfernt – damit schließt der Raum für alle."
                            : `„${name}“ verlässt den Raum und kann ihm nicht wieder beitreten.`}
                        </p>
                      }
                      icon="exit"
                      iconOnly
                      id={`room-kick-${room.code}-${p.playerId}`}
                      label={`„${name}“ aus Raum entfernen`}
                      reason={{
                        label: "Grund",
                        placeholder: "z. B. Belästigung im Chat",
                      }}
                      submitLabel="Aus Raum entfernen"
                      title={`„${name}“ aus Raum ${room.code} entfernen`}
                    />
                  </RowActions>
                </td>
              </tr>
            );
          })}
          {room.players.length === 0 ? (
            <tr>
              <td className="text-muted" colSpan={4}>
                Niemand im Raum.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </article>
  );
}

export default async function LiveRoomsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const result = await api<AdminRelayRoomList>("/admin/relay/rooms");
  const rooms = result.ok ? result.data.rooms : [];
  const now = result.ok ? new Date(result.data.time).getTime() : Date.now();
  const players = rooms.reduce((sum, r) => sum + r.playerCount, 0);
  const running = rooms.filter((r) => r.started).length;

  return (
    <>
      <PageTitle
        actions={
          <Link className="btn" href="/live-raeume">
            Neu laden
          </Link>
        }
        icon="live"
        sub="Offene Koop-Räume auf dem Relay-Server, ältester zuerst. Schließen und Entfernen brauchen einen Grund und stehen im Protokoll."
      >
        Live-Räume
      </PageTitle>
      <Flash params={params} />

      {result.ok ? (
        <>
          <p className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Fact label="Räume">{rooms.length}</Fact>
            <Fact label="Spieler">{players}</Fact>
            <Fact label="Runs laufen">{running}</Fact>
            <Fact label="Stand">{formatDateTime(result.data.time)}</Fact>
          </p>
          {rooms.length === 0 ? (
            <p className="card px-4 py-3 text-muted">
              Gerade ist kein Raum offen.
            </p>
          ) : (
            <div className="grid items-start gap-5 min-[112.5rem]:grid-cols-2">
              {rooms.map((room) => (
                <RoomCard key={room.code} now={now} room={room} />
              ))}
            </div>
          )}
        </>
      ) : result.error === "relay_not_configured" ? (
        <Notice title="Kein Relay eingerichtet">
          <p>
            Die API kennt keinen Relay-Server. Trage{" "}
            <code className="text-soft">RELAY_INTERNAL_URL</code> und{" "}
            <code className="text-soft">RELAY_INTERNAL_KEY</code> in der
            Umgebung der API ein und starte sie neu.
          </p>
        </Notice>
      ) : result.error === "relay_unavailable" ? (
        <Notice title="Relay gerade nicht erreichbar">
          <p>{result.message} Die Liste lädt beim nächsten Aufruf neu.</p>
        </Notice>
      ) : result.status === 404 ? (
        <Notice title="Noch keine Live-Räume">
          <p>
            Diese API-Version kennt <code>/admin/relay/rooms</code> noch nicht.
          </p>
        </Notice>
      ) : (
        <ErrorBox message={result.message} />
      )}
    </>
  );
}
