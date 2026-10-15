import type { AdminRelayRoomList, RelayRoomSummary } from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { closeRelayRoom, kickRelayPlayer } from "@/app/actions";
import { DangerAction } from "@/components/danger-action";
import {
  Chip,
  EmptyRow,
  ErrorBox,
  Flash,
  Notice,
  PageTitle,
  TableCard,
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

/** One room as a table row; players with their kick action are listed inside the row. */
function RoomRow({ room }: { room: RelayRoomSummary }) {
  return (
    <tr>
      <td className="whitespace-nowrap">
        <span className="font-data text-soft" title={room.createdAt}>
          {room.code}
        </span>
      </td>
      <td className="whitespace-nowrap">
        {ROOM_MODE_LABEL[room.mode] ?? room.mode}
        {room.guildId ? (
          <div>
            <Link className="link text-xs" href={`/gilden/${room.guildId}`}>
              Zur Gilde
            </Link>
          </div>
        ) : null}
      </td>
      <td>
        <div className="space-y-1">
          {room.started ? (
            <Chip tone="active">Run läuft</Chip>
          ) : (
            <Chip tone="muted">Lobby</Chip>
          )}
          <div className="whitespace-nowrap text-muted text-xs">
            <span className="font-data">{room.runsStarted}</span>{" "}
            {room.runsStarted === 1 ? "Run" : "Runs"} gestartet
          </div>
          {room.expiresAt ? (
            <div className="whitespace-nowrap text-muted text-xs">
              Lobby bis{" "}
              <span className="font-data">
                {formatDateTime(room.expiresAt)}
              </span>
            </div>
          ) : null}
        </div>
      </td>
      <td className="min-w-72">
        <div className="mb-1 font-data">
          {room.playerCount} / {room.maxPlayers}
        </div>
        <ul className="space-y-2">
          {room.players.map((p) => {
            const name = p.name ?? "(Name unbekannt)";
            return (
              <li key={p.peerId}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    className="link font-semibold"
                    href={`/spieler/${p.playerId}`}
                  >
                    {name}
                  </Link>
                  {p.host ? <Chip tone="flagged">Host</Chip> : null}
                  <span className="text-muted text-xs">
                    {PLATFORM_LABEL[p.platform] ?? p.platform} ·{" "}
                    <span className="font-data">
                      {formatAge(p.inRoomSeconds)}
                    </span>
                  </span>
                </div>
                <div className="mt-1">
                  <DangerAction
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
                    reason={{
                      label: "Grund",
                      placeholder: "z. B. Belästigung im Chat",
                    }}
                    small
                    submitLabel="Aus Raum entfernen"
                    trigger="Entfernen…"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </td>
      <td className="whitespace-nowrap">
        <span className="font-data">{formatAge(room.ageSeconds)}</span>
        <div className="font-data text-muted text-xs">
          {formatDateTime(room.createdAt)}
        </div>
      </td>
      <td className="font-data text-muted">{room.gameVersion}</td>
      <td className="whitespace-nowrap font-data text-muted text-xs">
        <div title="Spielpakete zum Relay">
          ↓ {formatRate(room.bytesInPerSecond)}
        </div>
        <div title="Spielpakete vom Relay">
          ↑ {formatRate(room.bytesOutPerSecond)}
        </div>
      </td>
      <td>
        <DangerAction
          action={closeRelayRoom.bind(null, room.code)}
          description={
            <p>
              Alle {room.playerCount} Spieler verlassen den Raum
              {room.started ? ", der laufende Run endet" : ""}. Sie sehen, dass
              die Moderation den Raum geschlossen hat.
            </p>
          }
          reason={{
            label: "Grund",
            placeholder: "z. B. Missbrauch, Belästigung",
          }}
          small
          submitLabel={`Raum ${room.code} schließen`}
          trigger="Schließen…"
        />
      </td>
    </tr>
  );
}

function RoomTable({ rooms }: { rooms: RelayRoomSummary[] }) {
  return (
    <TableCard>
      <table className="table">
        <caption className="sr-only">Offene Räume, ältester zuerst</caption>
        <thead>
          <tr>
            <th>Raum</th>
            <th>Modus</th>
            <th>Status</th>
            <th>Spieler</th>
            <th>Offen seit</th>
            <th>Version</th>
            <th>Verkehr</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <RoomRow key={room.code} room={room} />
          ))}
          {rooms.length === 0 ? (
            <EmptyRow colSpan={8}>Gerade ist kein Raum offen.</EmptyRow>
          ) : null}
        </tbody>
      </table>
    </TableCard>
  );
}

export default async function LiveRoomsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const result = await api<AdminRelayRoomList>("/admin/relay/rooms");

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
          <p className="mb-6 text-muted text-sm">
            Stand{" "}
            <span className="font-data text-soft">
              {formatDateTime(result.data.time)}
            </span>{" "}
            · <span className="font-data">{result.data.rooms.length}</span>{" "}
            {result.data.rooms.length === 1 ? "Raum" : "Räume"} offen
          </p>
          <RoomTable rooms={result.data.rooms} />
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
