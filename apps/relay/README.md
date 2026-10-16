# Soulwick Relay (`@soulwick/relay`)

## Zweck

WebSocket-Dienst für Online-Runs (D-119, P-016): Spieler auf allen Plattformen (Steam-PC, Android, später
iOS) treffen sich per **Raumcode**, der Relay leitet die Godot-Pakete zwischen Host und Clients weiter.
Der Host-Spieler entscheidet alles, der Relay **liest keine Paketinhalte**. Räume liegen nur im Speicher;
es gibt keine Datenbank. Ban- und Gildenstatus fragt der Relay bei der API (interner Endpunkt).

Konzept: [docs/KONZEPT_ONLINE.md](../../docs/KONZEPT_ONLINE.md) §2 · Vertrag: [packages/contracts/src/lobby.ts](../../packages/contracts/src/lobby.ts) ·
Gegenstück im Spiel: `online/relay_peer.gd` (`MultiplayerPeerExtension` auf `WebSocketPeer`, Spiel-Repo CP3/MP2).

## Start (lokal)

```bash
bun install                                   # im Repo-Wurzelordner
cp apps/relay/.env.example apps/relay/.env.local   # API_INTERNAL_URL und RELAY_INTERNAL_KEY kommen aus der Wurzel-.env.local
bun run dev:relay                             # ws://localhost:8790/v1, http://localhost:8790/health
bun run --cwd apps/relay dev --sim-latency=120 --sim-loss=5   # schlechtes Netz simulieren (nur lokal)
```

`bun dev` startet den Relay zusammen mit API, Web und Admin. `API_INTERNAL_URL` ist Pflicht: Dort holt
der Relay die öffentlichen Schlüssel der Spieler-JWTs (`/auth/jwks`, P-027) und fragt Sperr- und
Gildenstatus. Ohne `RELAY_INTERNAL_KEY` (oder wenn die API nicht antwortet) funktionieren Schnelle Spiele
weiter, Gildenräume antworten `api_unavailable`; ohne je geladene Schlüssel wird jedes `hello` mit
`unauthorized` abgelehnt. In einen Gildenraum darf, wer die Gilde in `guildIds` des Status hat (mehrere
Gilden je Spieler, D-147/P-031; ältere APIs: `guildId`); sagt die zwischengespeicherte Antwort „kein
Mitglied“, fragt der Relay vor `not_guild_member` einmal frisch nach. Handy per USB: `adb reverse tcp:8790 tcp:8790`.

## Protokoll (Kurzfassung für den GDScript-Client)

**Verbindung:** `ws://localhost:8790/v1` (lokal), `wss://play.playsoulwick.com/v1` bzw.
`wss://play-dev.playsoulwick.com/v1` (Vorschlag P-018). Das Token steht nicht in der URL.

**Token (P-027):** `hello.token` ist das kurzlebige JWT aus `GET /auth/token` der API (mit dem
Session-Token der Anmeldung als Bearer geholt, 15 min gültig), **nicht** das Session-Token selbst. Vor jeder
neuen Verbindung ein frisches JWT holen; eine laufende Verbindung bleibt bestehen, wenn es später abläuft.

**Steuer-Nachrichten** sind JSON-Textrahmen mit Feld `type`:

| Richtung | `type` | Felder | Antwort / Wirkung |
| --- | --- | --- | --- |
| Spiel → Relay | `hello` | `token`, `protocolVersion` (int), `gameVersion`, `platform` (`windows`, `linux`, `macos`, `android`, `ios`) | `welcome` oder `error` + Verbindungsende; muss innerhalb von 5 s kommen |
| Relay → Spiel | `welcome` | `playerId`, `name` (null ohne API), `protocolVersion`, `maxFrameBytes`, `maxPlayers`, `clientRouting` | – |
| Spiel → Relay | `create` | `mode` (`quick` \| `guild`), bei `guild` `guildId` | `created` (`code`, `peerId: 1`, `room`) + `room_state` |
| Spiel → Relay | `join` | `code` (Groß-/Kleinschreibung egal) | `joined` (`code`, `peerId` ≥ 2, `room`); alle anderen `peer_joined` (`peer`); alle `room_state` |
| Host → Relay | `start` | – | alle `started` + `room_state`; bis `end_run` keine Beitritte (`room_started`) |
| Host → Relay | `end_run` | `reason` (optional: `portal`, `wiped`, `abandoned`) | Run vorbei, zurück in die Lobby: alle `run_ended` + `room_state` (`started: false`, neues `expiresAt`); Beitritte wieder möglich, `start` startet den nächsten Run. Ohne laufenden Run `room_not_started` |
| Host → Relay | `kick` | `peerId` | Ziel `room_closed` (`kicked`), alle anderen `peer_left` (`kicked`); Wiederbeitritt gesperrt |
| Spiel → Relay | `leave` | – | selbst `room_closed` (`left`); Client: andere `peer_left` (`left`); Host: andere `room_closed` (`host_left`) |
| Spiel → Relay | `ping` | `t` (optional) | `pong` mit demselben `t` |
| Relay → Spiel | `room_state` | `room` (`code`, `mode`, `guildId`, `hostPeerId`, `started`, `maxPlayers`, `gameVersion`, `peers[]`, `expiresAt`) | nach jeder Änderung an alle |
| Relay → Spiel | `run_ended` | `reason` (`portal`, `wiped`, `abandoned` oder `null`, wenn der Host keinen nannte) | an alle (auch den Host) nach `end_run`, danach `room_state` |
| Relay → Spiel | `peer_left` | `peerId`, `reason` (`left`, `kicked`, `disconnected`) | – |
| Relay → Spiel | `room_closed` | `code`, `reason` (`left`, `host_left`, `expired`, `kicked`, `shutdown`, `closed_by_admin`) | Verbindung bleibt offen; `closed_by_admin` = ein Moderator hat den Raum über das Admin-Panel geschlossen (Spiel: `LOBBY_ERR_CLOSED_BY_ADMIN`; ergänzt ohne neue `PROTOCOL_VERSION`, unbekannte Gründe wie `host_left` behandeln) |
| Relay → Spiel | `error` | `code`, `message`, `request` (optional) | – |

**Fehlercodes:** `unauthorized`, `hello_required`, `banned`, `version_mismatch`, `invalid_message`,
`room_not_found`, `room_full`, `room_started`, `not_guild_member`, `already_in_room`, `kicked`,
`not_in_room`, `not_host`, `peer_not_found`, `invalid_target`, `api_unavailable`, `rate_limited`,
`frame_too_large`, `internal`, `room_not_started` (`end_run` ohne laufenden Run).

**Close-Codes:** 1001 Neustart (`shutdown`), 4000 Zeitüberschreitung (Herzschlag/untätig),
4001 `unauthorized`/`hello_required`, 4003 `banned`, 4006 `version_mismatch`, 4008 `rate_limited` (wiederholt bei unzuverlässigen Paketen, sofort bei einem
zuverlässigen über dem Limit), 4010 Empfänger zu langsam (Rückstau länger als
`SLOW_CONSUMER_GRACE_SECONDS` über `MAX_BUFFERED_BYTES`).

**Spielpakete** sind Binärrahmen, 10 Byte Kopf, Little Endian, danach das Godot-Paket unverändert:

| Offset | Typ | Feld | Bedeutung |
| --- | --- | --- | --- |
| 0 | int32 | `from` | Absender; **setzt der Relay** (eigener Wert wird überschrieben) |
| 4 | int32 | `to` | Ziel: Peer-ID, `0` = alle, negativ = alle außer `-to` |
| 8 | uint8 | `channel` | Godot-Kanal |
| 9 | uint8 | `mode` | 0 unreliable, 1 unreliable ordered, 2 reliable |
| 10 | Bytes | `data` | Godot-Paket |

GDScript: `decode_s32(0)`, `decode_s32(4)`, `decode_u8(8)`, `decode_u8(9)`, `slice(10)`; beim Senden
`encode_s32`/`encode_u8`. Testvektoren: `RELAY_FRAME_TEST_VECTORS` in `lobby.ts`.

**Regeln:** Host = Peer 1, Clients 2, 3, … (nie wiederverwendet). Ein Rahmen geht nie an den Absender
zurück. Mit `CLIENT_ROUTING=host_only` (Standard) dürfen Clients nur an den Host senden (`to = 1`);
Godots `SceneMultiplayer` leitet Client-zu-Client-RPCs dann über den Host (`server_relay`). Rahmen an
Peers, die nicht (mehr) im Raum sind, werden still verworfen. Höchstens 4 Spieler, ein Raum je Spieler,
Beitritt nur mit gleicher `gameVersion` wie der Host und nur in der Lobby (vor `start` oder nach `end_run`);
ein Raum in der Lobby schließt nach 10 Minuten ohne `start` (Uhr startet bei `create` und bei jedem `end_run`
neu). Ein Raum kann beliebig viele Runs nacheinander haben; vom Host entfernte Spieler bleiben für den ganzen
Raum gesperrt. Alte Clients, die nie `end_run` senden, verhalten sich wie bisher (ein Run je Raum).
Der Relay pingt alle 15 s (WebSocket-Ping, Godot antwortet automatisch) und trennt nach 30 s Stille
(Close 4000); jede Nachricht und jedes Spielpaket zählt als Lebenszeichen. Das Spiel schickt nach
`welcome` zusätzlich alle 20 s einen eigenen `ping` (misst die Laufzeit, hält Cloudflare und Traefik
beschäftigt) und gibt die Verbindung selbst nach 50 s ohne Daten auf. Das Relay-JWT wird nur bei
`hello` geprüft: Sein Ablauf (15 min) beendet keine laufende Verbindung.

## HTTP

| Route | Zweck |
| --- | --- |
| `GET /health` | öffentlich: `status`, `protocolVersion`, `rooms`, `players`, `connections`, `time`; 503 beim Herunterfahren |
| `GET /metrics` | nur mit Header `x-relay-key` (= `RELAY_INTERNAL_KEY`): Zähler, Bytes/s, verworfene Rahmen, Fehler; ohne Schlüssel 404 |
| `GET /v1` | WebSocket-Upgrade (429 bei zu vielen Verbindungen je IP, 426 ohne Upgrade) |
| `GET /internal/rooms` | nur für die API (P-024): offene Räume ohne Tokens/IPs (Code, Modus, Spieler mit ID, Name, Plattform, Host-Markierung, Alter, Runs, Bytes/s je Raum über 5 s) |
| `POST /internal/rooms/:code/close` `{ reason }` | alle (auch der Host) bekommen `room_closed` (`closed_by_admin`), Raum weg; `404 room_not_found` |
| `POST /internal/rooms/:code/kick` `{ playerId, reason }` | wie ein Host-Kick (`room_closed kicked`, andere `peer_left kicked`, Wiederbeitritt gesperrt); Host gekickt → Raum zu, andere `host_left`; `404 player_not_in_room` |
| `POST /internal/players/:playerId/ban` | nach einer Sperre in der API: Status-Cache leeren, alle Verbindungen des Spielers mit `banned` (4003) trennen |

Die `/internal/*`-Endpunkte brauchen keine neue `PROTOCOL_VERSION` (nur der Grund `closed_by_admin` kam hinzu); Vertrag: `RELAY_INTERNAL_PATHS` und
`RelayRoomList`, `RelayCloseRoomRequest`, `RelayKickRequest`, `RelayBanPlayerResponse` in `lobby.ts`.

## Umgebungsvariablen

| Variable | Pflicht | Standard | Bedeutung |
| --- | --- | --- | --- |
| `RELAY_PORT` (oder `PORT`) | nein | `8790` | Port |
| `PROTOCOL_VERSION` | nein | `1` | Nur Clients mit genau dieser Version (P16) |
| `API_INTERNAL_URL` | ja | – | Interne Adresse der API, z. B. `http://soulwick-api:8787`: JWKS der Spieler-JWTs und Sperr-/Gildenstatus |
| `JWKS_URL` | nein | `<API_INTERNAL_URL>/auth/jwks` | Andere Adresse der öffentlichen Schlüssel |
| `JWKS_CACHE_SECONDS` | nein | `600` | TESTWERT: so lange wird der Schlüsselsatz wiederverwendet; ein unbekannter `kid` lädt früher neu (höchstens alle 30 s) |
| `RELAY_INTERNAL_KEY` | nein | leer | Gleich wie `RELAY_INTERNAL_KEY` der API; schützt auch `/metrics` und `/internal/*` (falscher Schlüssel 401, leer = `/internal/*` aus, 404) |
| `STATUS_CACHE_SECONDS` | nein | `30` | TESTWERT: Antworten der API werden so lange wiederverwendet |
| `CLIENT_ROUTING` | nein | `host_only` | `host_only` oder `any` (Entscheidung mit MP2) |
| `MAX_FRAME_BYTES` | nein | `65536` | TESTWERT: größter Rahmen (Kopf + Paket) |
| `MAX_MESSAGES_PER_SECOND` / `MAX_BYTES_PER_SECOND` | nein | `1000` / `1048576` | TESTWERTE je Verbindung (Puffer für 2 s); darüber werden unzuverlässige Pakete verworfen, ein zuverlässiges trennt sofort (4008 `rate_limited`) |
| `RATE_LIMIT_STRIKES` | nein | `5` | Limit-Hinweise (höchstens 1/s), danach Verbindungsende |
| `MAX_CONNECTIONS_PER_IP_PER_MINUTE` | nein | `30` | TESTWERT |
| `MAX_BUFFERED_BYTES` | nein | `4194304` | TESTWERT: Rückstau je Empfänger; darüber werden unzuverlässige Pakete verworfen, zuverlässige weiter eingereiht |
| `SLOW_CONSUMER_GRACE_SECONDS` | nein | `5` | TESTWERT: bleibt der Rückstau so lange über `MAX_BUFFERED_BYTES`, wird der Empfänger getrennt (4010 `slow_consumer`); `0` = sofort |
| `ROOM_IDLE_MINUTES` / `IDLE_MINUTES` | nein | `10` / `10` | TESTWERTE: Raum ohne Start / Verbindung ohne Raum |
| `HELLO_TIMEOUT_SECONDS` | nein | `5` | TESTWERT |
| `HEARTBEAT_INTERVAL_SECONDS` / `HEARTBEAT_TIMEOUT_SECONDS` | nein | `15` / `30` | TESTWERTE |
| `TRUST_PROXY` | nein | `true` | Client-IP aus `X-Forwarded-For` (hinter Traefik) |
| `LOG_LEVEL` | nein | `info` | `info`, `error`, `silent`; JSON-Zeilen ohne Paketinhalte |
| `RELAY_SIM_LATENCY_MS` / `RELAY_SIM_LOSS` | nein | `0` / `0` | Nur lokal (in `production` ignoriert): Verzögerung je Paket, Verlust in Prozent nur für unzuverlässige Pakete; auch als `--sim-latency=…`, `--sim-loss=…` |

## Befehle

| Befehl | Was passiert |
| --- | --- |
| `bun run dev:relay` | Relay mit Neustart bei Änderungen |
| `bun test apps/relay` | Tests (Protokoll, Räume, Anmeldung, Weiterleitung, Limits, Ende-zu-Ende mit echten WebSockets) |
| `bun run --filter @soulwick/relay typecheck` | TypeScript prüfen |
| `docker build -f apps/relay/Dockerfile -t soulwick-relay .` | Image bauen (Kontext = Repo-Wurzel) |
| `docker run --rm -p 8790:8790 -e API_INTERNAL_URL=http://host.docker.internal:8787 soulwick-relay` | Image starten, `/health` prüfen |

**Betrieb:** genau **eine** Replica je Umgebung (Räume im Speicher). Ein Neustart schließt alle Räume
(`room_closed` mit `shutdown`, dann Close 1001); das Spiel behandelt das wie einen Host-Abbruch.
Deshalb den Relay nicht automatisch bei jedem Push deployen (`infra/DOKPLOY.md` §6). Im Log: `signal`
und `shutdown` beim Stoppen; `connection_close` je Verbindung mit `code`, `room`, `peerId`, `silentMs`
(Stille vor dem Ende), `maxFrameIn` (größtes Paket) und den Spitzen je Sekunde
`peakMessagesInPerSecond`, `peakBytesInPerSecond`, `peakMessagesOutPerSecond`, `peakBytesOutPerSecond`;
`slow_consumer` mit `buffered` und `overMs` (so lange über der Grenze); `rate_limited` mit `reliable: true`,
wenn ein zuverlässiges Paket die Trennung auslöste. `/metrics`
meldet zusätzlich `maxFrameIn`.
Dokploy-Einrichtung: ROADMAP P17.
