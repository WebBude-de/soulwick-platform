# KONZEPT Online – Relay, Anmeldung, Deployment und Stores

> **Stand:** 17.10.2026 · **Status:** Architektur **entschieden** (Spiel-Repo D-119, Projektmitglied 14.10.2026), alles Weitere ist **Vorschlag** von Claude oder **OFFEN**. Die Plattform-Seite ist gebaut (Relay P13, Anmeldung P14, Konten P15, Versionen P16, Gast P20); der Betrieb auf dem Server steht noch aus (P2, P17, [../infra/DOKPLOY.md](../infra/DOKPLOY.md)).
> **Für wen:** Entwickler und Agenten, die Relay, Anmeldung, Deployment und Store-Anbindung bauen. Umsetzung als Pakete: [ROADMAP.md](ROADMAP.md) P13–P17 (Plattform), `soulwick/docs/ROADMAP_CROSSPLAY.md` CP1, CP3, CP7 und `soulwick/docs/ROADMAP_MULTIPLAYER.md` MP2–MP6 (Spiel).
> **Entscheidungen:** Spiel-Repo D-083, D-084, D-085, D-108, **D-119**; hier [DECISIONS.md](DECISIONS.md) P-008, P-014, **P-016 bis P-018**, **P-027** (Better Auth, Relay-JWT über JWKS, 15.10.2026), **P-031**/**P-032** (mehrere Gilden je Spieler, Gilden-Raum nur für Mitglieder, Gildenkasse nach Gilden-Run; D-147). Bei Widerspruch gilt das Spiel-Repo.
> **Kennzeichnung:** **ENTSCHIEDEN** = Projektmitglied hat entschieden · **VORSCHLAG** = von Claude ausgearbeitet, vom Team zu bestätigen · **OFFEN** = noch nicht entschieden, nicht still festlegen · **TESTWERT** = Zahl zum Nachjustieren.

## 0. Entscheidungsstand

| Thema | Stand | Quelle |
| --- | --- | --- |
| Netzwerk: Host-Modell (ein Spieler rechnet) plus eigener Relay | **ENTSCHIEDEN** 14.10.2026 | D-119 (CP0 Frage 3a) |
| Transport Phase 1: WebSocket-Relay über `online/relay_peer.gd` (`MultiplayerPeerExtension` auf `WebSocketPeer`) | **ENTSCHIEDEN** 14.10.2026 | D-119 |
| WebRTC-Direktverbindung, dedizierter Godot-Server | später, als austauschbare Aufrüstung | D-119 |
| Release gemeinsam auf allen Versionen: Browser, Steam, Android, iOS (ersetzt die Reihenfolge Steam → Android → iOS, iOS später) | **ENTSCHIEDEN** 17.10.2026 | D-179 (CP0 Frage 4, vorher D-119) |
| Publisher WebBude (Firmenkonten Steam, Google und Apple; Apple wegen D-179 schon vor dem Release) | **ENTSCHIEDEN** 14.10.2026 | D-119, D-179 |
| Relay als eigener Bun-Dienst `apps/relay` | Grundsatz entschieden, Umsetzung **VORSCHLAG** | P-016 |
| Steam nur Zusatz (kein Steam-Relay als Hauptweg) | **VORSCHLAG** (folgt aus D-119) | P-017 |
| Domains `play.playsoulwick.com`, `dev.`-Subdomains, zwei Umgebungen | **VORSCHLAG** | P-018, P-008 |
| Konto-Modell (Soulwick-Konto mit verknüpften Identitäten) | **ENTSCHIEDEN** (CP0 Frage 2a, 14.10.2026) | D-121, P-014 |
| Regel für das Zusammenführen zweier Konten | **ENTSCHIEDEN** (14.10.2026, §3.6) | D-122 |
| Geschäftsmodell (Käufe, Werbung, Steam-Preis) | **ENTSCHIEDEN** als Arbeitsgrundlage (17.10.2026): Browser und Handy kostenlos, Steam kleiner Preis, nur Kosmetik und „Werbefrei“; Preise OFFEN | D-176 |
| Touch-Schema | **ENTSCHIEDEN** (Pixel-Art-Touch-Steuerung) | D-168 |
| Relay-Regionen | **OFFEN** (CP0 Frage 10); zuerst eine Instanz | – |
| Konto-Profil: ein Charakter (Name + Aussehen) je Konto, Spielstände sind nur Welten | **ENTSCHIEDEN** (D-152, 16.10.2026), Grenzen TESTWERT | P-034, §3.4a |
| Bug-Meldungen aus dem Spiel mit Screenshot, 90 Tage, Löschung mit dem Konto | **ENTSCHIEDEN** (Auftrag 16.10.2026), Zahlen TESTWERT | P-033, §3.7a |

## 1. Zielarchitektur

```text
Steam-PC ─┐                       ┌─ soulwick-api      (Hono/Bun: Konto, Identitäten, Gilden, Runs, Ranglisten)
Android  ─┤                       │
iOS      ─┼─ HTTPS ───────────────┤
Browser  ─┘                       └─ soulwick-postgres
   │
   └─ WSS ── soulwick-relay (Bun, neu): Lobby, Raumcodes, Paket-Weiterleitung, prüft das Spieler-JWT
             Der Host-Spieler entscheidet alles (Spiellogik nur im Spiel), der Relay leitet nur weiter.
```

- **Transport (ENTSCHIEDEN):** eigene `MultiplayerPeerExtension` in GDScript (`online/relay_peer.gd`) über Godots eingebautes `WebSocketPeer`. Läuft ohne GDExtension auf Windows, Linux, macOS, Android und iOS; kein NAT-Problem, keine Portfreigaben. Spielpakete als binärer Rahmen `{from, to, channel, mode, data}` (§2.4).
- **Steam ist Zusatz, nicht Pflicht (VORSCHLAG P-017):** GodotSteam (GDExtension, unterstützt Godot 4.7) für die Anmeldung (`/auth/steam`), Freunde einladen und „Beitreten“ über Rich Presence, die nur den **Raumcode** trägt. Die Verbindung läuft auch für Steam-Spieler über den Relay, damit Handy und PC im selben Raum sind.
- **Später austauschbar:** WebRTC-Direktverbindung (webrtc-native, Relay bzw. TURN als Rückfall) senkt den Server-Traffic; ein dedizierter Godot-Server senkt Host-Probleme. Beides ohne Spiellogik-Umbau, weil der Peer austauschbar ist und der Host-Code keinen eigenen Spieler voraussetzt (`soulwick/docs/MULTIPLAYER.md` §4a, „Regel“).
- **Gameserver-Frage:** Godot exportiert einen **„Dedicated Server“** (Linux, headless, ohne Grafik und Audio, eine Binärdatei). Ein Docker-Image schreibt man selbst (`debian:bookworm-slim` + Binärdatei). In Phase 1 **nicht nötig**, der Host ist ein Spieler. Vorgesehen als späteres Paket, wenn Handy-Hosts (App im Hintergrund = Run-Ende nach D-085), Cheats oder Host-Abbrüche stören. Hosting dann zuerst als Container-Pool auf dem eigenen VPS, bei Bedarf über einen Anbieter mit Regionen (Edgegap o. ä.).
- **Offline zuerst:** Einzelspieler braucht keinen Server. Ist API oder Relay nicht erreichbar, zeigt das Spiel einen Status und bleibt allein spielbar.

## 2. Relay `apps/relay`

### 2.1 Aufbau (VORSCHLAG, P-016)

- Bun + WebSocket (`Bun.serve` mit `websocket`-Handler), gleiche Werkzeuge wie die API: Biome, `bun test`, TypeScript `strict`, Dockerfile auf `oven/bun:1.3`.
- Nachrichtenformen aus `packages/contracts/src/lobby.ts` (zod für JSON-Steuer-Nachrichten, Konstanten für den Binärrahmen). **Verträge zuerst**, wie bei der API.
- Kein Datenbankzugriff; Räume liegen nur im Speicher. Für Gildenräume und Sperren fragt der Relay die API (§2.7).
- Eine Instanz zuerst (wie die API, P-008), genau eine Replica, weil Räume im Speicher liegen. Später je Region eine Instanz; der Raumcode bekommt dann ein Regions-Präfix (OFFEN).
- Konfiguration: `RELAY_PORT` (lokal 3103), `API_INTERNAL_URL` (Pflicht: JWKS und Status, P-027), optional `JWKS_URL` und `JWKS_CACHE_SECONDS`, `RELAY_INTERNAL_KEY`, `PROTOCOL_VERSION`, Grenzwerte (`MAX_FRAME_BYTES`, `MAX_BYTES_PER_SECOND`, `MAX_MESSAGES_PER_SECOND`, `ROOM_IDLE_MINUTES`), `TRUST_PROXY`, `LOG_LEVEL`; nur lokal `RELAY_SIM_LATENCY_MS`, `RELAY_SIM_LOSS` bzw. die Startoptionen `--sim-latency`, `--sim-loss`.

### 2.2 Verbindungsaufbau

1. Das Spiel öffnet `wss://play.playsoulwick.com/v1` (lokal `ws://localhost:3103/v1`).
2. Erste Nachricht innerhalb von 5 s (TESTWERT): `hello` mit Spieler-JWT (`token`, vorher über `GET /auth/token` der API geholt, P-027), `protocolVersion`, `gameVersion`, `platform` (`windows`, `linux`, `macos`, `android`, `ios`). Das Token steht bewusst **nicht** in der URL, damit es in keinem Zugriffsprotokoll landet (VORSCHLAG).
3. Der Relay prüft die JWT-Signatur selbst gegen die öffentlichen Schlüssel der API (EdDSA, JWKS unter `<API_INTERNAL_URL>/auth/jwks`, Cache 10 min, unbekannte `kid` lädt neu; P-027), dazu `aud` = `soulwick-relay`, das Ablaufdatum und die `protocolVersion`. Fehler → `error` und Verbindungsende. Geprüft wird nur bei `hello`; läuft das JWT (15 min) später ab, bleibt die Verbindung bestehen.
4. Antwort `welcome` mit `playerId` (`sub` des JWT) und Name und Konto-Level (`level`, D-188) aus der Statusabfrage der API; beides steht auch an jedem Platz im Raum (`RoomPeer`), Stand bei `hello`. Danach `create` oder `join`.
5. Herzschlag: WebSocket-Ping alle 15 s, Verbindung gilt nach 30 s ohne Antwort als getrennt (TESTWERTE).

### 2.3 Steuer-Nachrichten (JSON, Textrahmen)

| Richtung | Nachricht | Inhalt | Antwort / Wirkung |
| --- | --- | --- | --- |
| Spiel → Relay | `hello` | `token`, `protocolVersion`, `gameVersion`, `platform` | `welcome` oder `error` |
| Spiel → Relay | `create` | `mode` (`quick` \| `guild`), bei `guild` die `guildId` | `created` mit `code`, `peerId: 1` |
| Spiel → Relay | `join` | `code` | `joined` mit `peerId` (≥ 2) und Spielerliste; an alle anderen `peer_joined` |
| Host → Relay | `start` | – | Run läuft, keine Beitritte bis `end_run` (D-085); an alle `started` |
| Host → Relay | `end_run` | `reason` optional: `portal`, `wiped`, `abandoned` | Run vorbei, Gruppe zurück im Dorf: Raum wieder in der Lobby (`started: false`), 10-Minuten-Frist läuft neu (TESTWERT), Beitritte wieder erlaubt (Version, Größe, Kick-Sperre wie bisher); an alle `run_ended` (`reason` oder `null`) und `room_state`. Ohne laufenden Run: `room_not_started` |
| Host → Relay | `kick` | `peerId` | Ziel bekommt `room_closed` (`kicked`), alle anderen `peer_left` |
| Spiel → Relay | `leave` | – | Client: an alle `peer_left`. Host: Raum schließt, alle bekommen `room_closed` (`host_left`) |
| Relay → Spiel | `run_ended` | `reason`: `portal`, `wiped`, `abandoned` oder `null` | an alle (auch den Host) nach `end_run`, danach `room_state` |
| Relay → Spiel | `room_closed` | `reason`: `host_left`, `expired`, `kicked`, `shutdown`, `closed_by_admin` (Admin-Panel, P-024) | Verbindung bleibt offen, Spiel zeigt Hinweis |
| Relay → Spiel | `error` | `code` (unten), `message` | – |

**Fehlercodes (VORSCHLAG):** `unauthorized`, `banned`, `version_mismatch`, `room_not_found`, `room_full`, `room_started`, `room_not_started`, `not_guild_member`, `already_in_room`, `rate_limited`, `frame_too_large`, `internal`. Das Spiel übersetzt sie in verständliche Texte (Übersetzungsschlüssel, D-111).

### 2.4 Spielpakete (Binärrahmen)

Jedes Godot-Paket geht als ein binärer WebSocket-Rahmen über den Relay (VORSCHLAG, Little Endian):

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `from` | int32 | Absender-Peer-ID. **Setzt der Relay**; was der Absender einträgt, wird überschrieben. |
| `to` | int32 | Ziel: Peer-ID, `0` = alle, negativ = alle außer `-to` (Godot-Konvention) |
| `channel` | uint8 | Godot-Kanal |
| `mode` | uint8 | Godot-`TransferMode` (0 unreliable, 1 unreliable ordered, 2 reliable). Über WebSocket ist alles zuverlässig und geordnet; das Feld bleibt für spätere WebRTC-Peers. |
| `data` | Rest | Godot-Paket, unverändert und ungelesen |

- Peer-IDs: Host = 1, Clients bekommen vom Relay eindeutige IDs ≥ 2, wie es `MultiplayerPeer` erwartet.
- Der Relay prüft nur: Absender ist im Raum, Ziel ist im Raum, Rahmen nicht größer als `MAX_FRAME_BYTES` (TESTWERT 64 KiB), Bytes/s und Nachrichten/s der Verbindung im Limit.
- Option (VORSCHLAG, mit MP2 entscheiden): Clients dürfen nur an den Host (`to = 1`) senden; Godots `SceneMultiplayer` leitet Client-zu-Client-Aufrufe dann über den Host (`server_relay`). Das verkleinert die Angriffsfläche.
- `packages/contracts/src/lobby.ts` enthält Testvektoren (Bytefolgen), gegen die sowohl `bun test` als auch ein GUT-Test für `relay_peer.gd` laufen.

### 2.5 Raum-Lebenszyklus

```text
create ──► Lobby ──start──► Run läuft ──end_run──► Lobby ──start──► Run läuft ...
Lobby:   10 min ohne start ────────────────────────► geschlossen (expired)
immer:   Host geht / trennt ───────────────────────► geschlossen (host_left, D-085)
```

- **Code:** 6 Zeichen aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (ohne `0`/`O`, `1`/`I`/`L`), zufällig, eindeutig unter den offenen Räumen (VORSCHLAG).
- **Größe:** höchstens 4 Spieler einschließlich Host (D-084); `room_full` darüber.
- **Modus `guild`:** Beim `create` und jedem `join` fragt der Relay die API, ob der Spieler Mitglied der Gilde ist und nicht gesperrt (§2.7). Ein Spieler kann in mehreren Gilden sein (D-147, P-031): Er darf in den Raum, wenn die `guildId` des Raums in seiner Gildenliste steht, sonst `not_guild_member`. Modus `quick`: nur Sperrprüfung.
- **Ablauf:** offen ohne Start nach 10 Minuten (TESTWERT) → `expired`. Laufende Runs leben, bis der Host geht oder `end_run` sendet.
- **Mehrere Runs je Raum (MP3):** Nach einem Run kehrt die Gruppe ins gemeinsame Dorf zurück; der Host sendet `end_run`, der Raum ist wieder Lobby (Beitritte erlaubt, Frist neu), `start` beginnt den nächsten Run. Gekickte bleiben gesperrt. Reine Erweiterung, `PROTOCOL_VERSION` bleibt 1. Wiederbeitreten nach Verbindungsabbruch (`rejoin`) ist OFFEN (§8).
- **Host geht:** Raum schließt für alle; der Run endet wie in D-085 (Auszahlung wie Tod). Kein Host-Wechsel, kein Wiederbeitreten im laufenden Run.
- **Client geht:** `peer_left` an alle; der Run läuft weiter (D-085).
- **Ein Raum je Spieler:** ein zweites `create`/`join` derselben Spieler-ID → `already_in_room`.
- **Neustart des Relays:** alle Räume weg, die Spiele bekommen eine getrennte Verbindung und behandeln das wie einen Host-Abbruch. Dauerhafte Daten gehen nicht verloren (es gibt keine).

### 2.6 Schutz, Logs, Metriken

- JWT-Pflicht; abgelaufene, fremd signierte oder für eine andere `aud` ausgestellte Tokens → `unauthorized`. Das Session-Token der Anmeldung wird nicht angenommen.
- Rate-Limit je IP (Verbindungen pro Minute) und je Spieler (Nachrichten/s, Bytes/s), Rahmengröße begrenzt; alle Grenzen als TESTWERT in der Konfiguration.
- `TRUST_PROXY=true` hinter Traefik (Client-IP aus `X-Forwarded-For`, wie P-005).
- Logs als JSON-Zeilen **ohne Paketinhalte**: Verbindung auf/zu, Raum erstellt/geschlossen, Fehler, Limit-Treffer, jeweils mit Spieler-ID, Raumcode, Grund.
- `GET /health` (Status, `protocolVersion`, Anzahl Räume); `GET /metrics` nur intern (Räume, Spieler, Bytes/s ein und aus).

### 2.7 Interner API-Endpunkt für den Relay (VORSCHLAG)

`GET /internal/relay/players/:playerId/status?guildId=…` mit Header `x-relay-key: <RELAY_INTERNAL_KEY>` → `{ playerId, name, banned, guildId, guildMember, guildIds }`. `guildIds` listet alle aktiven Gilden des Spielers (D-147, P-031), `guildId` bleibt die älteste (für ältere Relays). Nur im Docker-Netz der Umgebung gedacht; zusätzlich durch den Schlüssel geschützt, falls der Pfad doch öffentlich erreichbar ist. Das JWT prüft der Relay selbst (nur mit den öffentlichen Schlüsseln, P-027), die API wird nur für Gilden- und Sperrstatus gefragt (kurzer Cache im Relay, 30 s, TESTWERT). Die Mitgliedschaft steht bewusst **nicht** im JWT: Sie ändert sich während der 15 Minuten eines Tokens (Beitritt, Austritt, Rauswurf). Sagt der Cache „kein Mitglied“, fragt der Relay vor der Ablehnung einmal frisch nach (gerade beigetreten).

### 2.8 Gilden im Spiel (D-147, P-031, P-032)

Das Online-Menü (D-147) nutzt nur die Spieler-API (Bearer-Token der Anmeldung):

| Route | Zweck |
| --- | --- |
| `GET /me/guilds` | eigene Gilden (bis 5, TESTWERT) mit Rolle, Mitgliederzahl, Gildenkasse; `maxGuilds` |
| `POST /guilds` `{name, tag}` / `POST /guilds/join` `{inviteCode}` | Gilde gründen bzw. beitreten → `GuildDetail` |
| `GET /guilds/:id` | Mitglieder, Rollen, Fortschritt, `myRole`; Einladungscode nur für Gründer und Offiziere |
| `POST /guilds/:id/leave` | verlassen; Gründer → Übergabe nach P-102, letzte Person löst auf |
| `DELETE /guilds/:id/members/:playerId`, `PATCH …/members/:playerId {role}` | entfernen (Gründer alle, Offizier nur Mitglieder) bzw. Offizier ernennen/entlassen (nur Gründer) |
| `POST /guilds/:id/invite-code` | neuen Code erzeugen (Gründer, Offizier) |
| `GET/PATCH /guilds/:id/progress` | Gildenkasse und Schmiede mit Versionsprüfung (P-104) |

Ein **Gilden-Raum** ist ein Relay-Raum mit `create {mode: "guild", guildId}`. Am Run-Ende meldet der Host `POST /runs` mit `mode: "guild"`, `guildId`, `endReason`, `remainingGold` und einer einmal je Run erzeugten `reportId` (UUID; bei Wiederholung nach Netzfehler dieselbe, Antwort dann 200 ohne zweite Auszahlung); die API zahlt nach D-081 in die Gildenkasse (Portal 100 %, sonst 50 % aufgerundet; markierte Runs nichts, P-032) und antwortet mit `guildPayout` und dem neuen `guildProgress`. Der Run zählt für die Gilden-Rangliste.

## 3. Anmeldung, Konto und Versionen

Alle Anmeldewege liefern **dieselbe Antwort** `{token, expiresAt, player}`; `token` ist seit P-027 ein Better-Auth-Session-Token (Laufzeit `PLAYER_TOKEN_TTL_DAYS`, als `Authorization: Bearer`), erzeugt vom eigenen Plugin `soulwickPlayerAuth`, und alle hängen an der Tabelle `player_identities` (P-014). Für den Relay holt das Spiel mit diesem Token `GET /auth/token` (JWT, 15 min). Gesperrte Spieler bekommen `403 banned` (wie heute). Verträge neu in `packages/contracts/src/identity.ts` (VORSCHLAG).

| Provider | Route | Wann | Was der Server prüft |
| --- | --- | --- | --- |
| `device` | `POST /auth/dev` | Werkzeuge, Tests, Seed-Spieler | `x-dev-auth-key`; Geräte-ID ist zufällig je Installation bzw. je Instanz (`--player=n`) |
| `device` | `POST /auth/device` (Gast, P-028) | Test-Builds und Spieler ohne Steam/Google, jede Umgebung (Schalter `GUEST_AUTH_ENABLED`) | kein Schlüssel; nur Format der Geräte-ID und Rate-Limits je IP |
| `steam` | `POST /auth/steam` (P14; echter Test mit eigener AppID offen) | ab eigener AppID (MP10) | Ticket bei Steam (`AuthenticateUserTicket`) |
| `google_play` | `POST /auth/google-play` (P14) | ab Android-Build | Server-Auth-Code bei Google eintauschen |
| `game_center` | `POST /auth/game-center` (noch nicht gebaut) | mit der iOS-Version (zum Release, D-179) | Signatur von Apple |

### 3.1 Entwicklung (Geräte-ID)

Spiel erzeugt beim ersten Start eine zufällige Geräte-ID (bei `-- instance=n` je Instanz eine eigene) und ruft `POST /auth/dev` mit Name und Geräte-ID. Nur mit `DEV_AUTH_ENABLED=true`; in `production` zum Steam-Start aus. Seit P-028 melden sich Test-Builds ohne Schlüssel als Gast an (§3.1a); `/auth/dev` bleibt für Werkzeuge, Tests und die Seed-Spieler. Der `DEV_AUTH_KEY` wird **nie** in einen Build gepackt (MP4, 14.10.2026): Tester bekommen ihn privat und tragen ihn in `user://online.cfg` ein oder starten mit `-- dev_key=…`. Je Umgebung ein eigener Schlüssel; er schützt nur die Testphase und wird zum Steam-Start abgeschaltet (siehe `infra/DOKPLOY.md`).

### 3.1a Gastkonto je Gerät (ENTSCHIEDEN, P-028)

Wie die Gastkonten bei Among Us: Das Spiel erzeugt beim ersten Start eine zufällige UUID v4 (einmal pro Installation, 32–128 Zeichen, nur `A-Z a-z 0-9 -`) und ruft `POST /auth/device` mit `{ deviceId, name?, appearance? }` auf (Profil nur beim Anlegen, §3.4a), **ohne** Dev-Schlüssel. Antwort wie `/auth/dev`; dieselbe `device`-Identität, ein Gerät mit altem Dev-Login landet also im selben Konto. Die Geräte-ID ist das einzige Geheimnis des Kontos: nie anzeigen, nie loggen. Später verknüpft der Spieler das Gastkonto per Verknüpfungscode (§3.5) mit Steam oder Google Play; **ohne Verknüpfung ist das Konto mit dem Gerät (bzw. der Installation) verloren**, das Spiel weist darauf hin (CP1). Fehler: `400 validation_error`, `403 guest_auth_disabled` (Schalter `GUEST_AUTH_ENABLED=false`), `403 banned`, `429 rate_limited` (je IP 10 Anmeldungen je Minute und 20 neue Gastkonten je Stunde, TESTWERT). `GET /public/config` meldet `guestAuth`.

### 3.2 Steam

1. Spiel (GodotSteam): `getAuthTicketForWebApi("soulwick")` → Callback mit dem Ticket (Hex).
2. `POST /auth/steam` mit `ticket`.
3. API ruft `ISteamUserAuth/AuthenticateUserTicket/v1` mit dem **Publisher-Web-API-Schlüssel** (`STEAM_WEB_API_KEY`), `appid` (`STEAM_APP_ID`), `ticket` und `identity` (`STEAM_TICKET_IDENTITY` = `soulwick`).
4. Antwort `result = OK` → `steamid` (bei Familienfreigabe zusätzlich `ownersteamid`) → Identität `steam` finden oder anlegen → Session (P-027).
5. Der Schlüssel liegt **nur** auf dem Server (Dokploy, `production`). Mit der Test-AppID 480 lässt sich das nicht echt prüfen; dafür braucht es die eigene AppID (MP10).

### 3.3 Google Play (Play Games Services v2)

1. Spiel (Android-Plugin für Play Games Services v2; welches Plugin, ist OFFEN und wird in P14/CP1 geprüft): automatische Anmeldung, dann `requestServerSideAccess(serverClientId)` → **Server-Auth-Code**.
2. `POST /auth/google-play` mit `serverAuthCode`.
3. API tauscht den Code bei `https://oauth2.googleapis.com/token` (Client-ID und -Secret des Web-OAuth-Clients aus der Google Cloud Console, `GOOGLE_PLAY_CLIENT_ID`/`GOOGLE_PLAY_CLIENT_SECRET`, Namen VORSCHLAG) gegen ein Access-Token.
4. API ruft `https://games.googleapis.com/games/v1/players/me` → `playerId` → Identität `google_play` → Session (P-027).
5. **Nie** eine Spieler-ID vom Gerät übernehmen; nur die serverseitig ermittelte ID zählt.

### 3.4 Game Center (mit der iOS-Version)

1. Spiel: `fetchItems(forIdentityVerificationSignature:)` → `publicKeyURL`, `signature`, `salt`, `timestamp`; dazu `teamPlayerID` und die Bundle-ID.
2. `POST /auth/game-center` mit diesen Werten.
3. API prüft: `publicKeyURL` liegt auf einer Apple-Domain, Zertifikat laden (cachen), Signatur über `teamPlayerID` + Bundle-ID + `timestamp` (uint64, Big Endian) + `salt` prüfen, `timestamp` nicht älter als wenige Minuten (TESTWERT).
4. Identität `game_center` (Wert `teamPlayerID`) → Session (P-027).
5. Solange nur Game Center und Play Games angeboten werden (kein Social-Login), ist „Sign in with Apple“ voraussichtlich nicht nötig (CP0 Frage 8, OFFEN).

### 3.4a Konto-Profil: ein Charakter je Konto (ENTSCHIEDEN, D-152, P-034; Grenzen TESTWERT)

Ein Konto hat **einen** Charakter: Anzeigename und Aussehen (Figur `wick`/`ember`/`moss`/`frost` plus Farben `hair`, `outfit`, `skin`, optional `accent`, je Palettenindex 0..7). Spielstände sind nur noch „Welten“ (wie Minecraft-Maps) und geben dem Konto keinen Namen. Der Name ist ein Anzeigename, **nicht eindeutig**.

- **Erstes Anmelden:** Das Spiel schickt den Profilnamen und das Aussehen mit (`POST /auth/device { deviceId, name?, appearance? }`, ebenso `/auth/dev`, `/auth/steam`, `/auth/google-play`). Beides gilt nur beim Anlegen; ohne Namen heißt das Konto `Spieler-1234` (Zufallsziffern). Bestehende Konten behalten ihr Profil, ein mitgeschickter Name wird ignoriert.
- **Ändern:** `PATCH /me { name?, appearance? }` → `PlayerSelf`. Höchstens 3 eigene Namenswechsel je 24 Stunden (`429 name_change_limited` mit `retryAfter`); das Aussehen ist jederzeit frei änderbar; `appearance: null` = Standardfigur.
- **Sichtbar:** in `GET /me`, in den Mitgliederlisten der Gilden (`GuildDetail.members[].appearance`) und im Admin-Panel (nur lesen, dazu der Namensverlauf). Moderatoren benennen anstößige Namen ohne Grenze um.
- **Offen:** automatischer Filter gegen anstößige Namen (Store-Pflicht, §6/§7).

**Haken für das Spiel:** Profil-Editor (Name + Figur + Farben) beim ersten Online-Start bzw. im Konto-Panel; Werte aus `PlayerSelf.appearance` übernehmen (null oder unbekannte Figur → Standardfigur); Änderungen mit `PATCH /me`; den Spielstand-Namen nicht mehr an die Anmeldung schicken.

### 3.5 Konto verknüpfen (Verknüpfungscode, wie Among Us)

| Route | Zweck |
| --- | --- |
| `POST /me/link-code` | Gerät A erzeugt einen Code (6 Zeichen, 10 Minuten gültig, TESTWERT; Alphabet wie Raumcodes) |
| `POST /me/link` | Gerät B (angemeldet mit seiner eigenen Identität) löst den Code ein; seine Identität hängt danach am Konto von A |
| `GET /me/identities` | verknüpfte Provider anzeigen (ohne Provider-IDs im Klartext an Dritte) |
| `DELETE /me/identities/:provider` | Identität entkoppeln; die letzte Identität darf nicht entkoppelt werden |

Ablauf: B hat beim ersten Start automatisch ein eigenes (meist leeres) Konto bekommen. Ist dieses Konto leer (keine Gilde, keine Runs), wandert die Identität still zu A, das leere Konto wird gelöscht. Hat es Fortschritt, antwortet die API `409 account_has_progress`, und das Spiel fragt nach (nie stilles Zusammenführen, CP1).

### 3.6 Zwei Konten zusammenführen (ENTSCHIEDEN, D-122)

Regel (D-122): Das **ältere** Konto (früheres `created_at`) bleibt und bekommt die Identitäten des anderen. Gilden (seit D-147 mehrere je Konto, P-031): Die Mitgliedschaften des bleibenden Kontos gelten; die des anderen wandern samt Rolle mit, solange die Grenze von 5 Gilden nicht überschritten wird (älteste zuerst), in einer gemeinsamen Gilde bleibt die höhere Rolle, der Rest wird mit Übergabe nach P-102 verlassen. Run-Teilnahmen beider Konten werden umgehängt, der Name des bleibenden Kontos gilt, das andere Konto wird gelöscht. Ist eines der Konten gesperrt, wird nicht zusammengeführt (manuelle Prüfung im Admin-Panel). Gründerrolle, wenn das gelöschte Konto eine Gilde gegründet hat: geregelt in P-020 (Übergabe nach P-102, wenn das bleibende Konto schon eine Gilde hat).

### 3.7 Konto löschen (ENTSCHIEDEN, P-026: vollautomatisch)

Niemand prüft oder entscheidet Löschungen von Hand. Alle Wege nutzen dieselbe Löschlogik: Konto, Identitäten, Lösch- und Verknüpfungscodes, Sperr-Historie und Notizen gehen; die Gildenmitgliedschaft endet (Gründerrolle nach P-102, letzter Spieler löst die Gilde auf); Runs bleiben für die Gilden-Ranglisten, aber ohne Bezug zum Spieler (anonymisiert).

- **In der App:** `DELETE /me` (Knopf im Konto-Panel des Spiels, CP1). Gesperrte Spieler können das nicht (P-108).
- **Als Web-Seite (Google-Pflicht):** Seite `/delete-account` auf der Website (DE/EN), ohne Anmeldung, in zwei Schritten:
  1. Im Spiel (Konto-Panel) „Löschcode anzeigen“ → `POST /me/deletion-code` → `{code, expiresAt}`: 8 Zeichen (Alphabet ohne 0/O, 1/I/L), **15 min gültig, einmal verwendbar** (TESTWERT). Ein neuer Code ersetzt den alten. Gespeichert wird nur ein HMAC.
  2. Website: Spielername + Code → `POST /account-deletion/verify` → kurzlebiges Bestätigungstoken (10 min, TESTWERT) und Anzeige „Spielername, Gilde, Anzahl Runs“. Jeder Fehler heißt gleich `400 invalid_deletion_code` (kein Hinweis, ob der Name existiert). Schutz: 5 Prüfungen je IP und Stunde (`DELETION_REQUESTS_PER_HOUR`), dazu höchstens 5 falsche Codes je Spielername, danach ist dessen Code verbrannt.
  3. Website: „Endgültig löschen“ → `POST /account-deletion/confirm {token}` → Konto sofort gelöscht, Code verbraucht. Fehler `400 deletion_token_invalid` (abgelaufen, schon benutzt oder Code inzwischen ersetzt). Ein gesperrtes Konto wird trotzdem gelöscht (DSGVO) und im Protokoll markiert.
- **Ohne Zugang zum Spiel:** Die Website zeigt die Support-Adresse aus `GET /public/config` (`supportEmail`, Variable `SUPPORT_EMAIL`, leer = keine Anzeige). Ein Admin löscht dann per `DELETE /admin/players/:id` (gleiche Logik). Das gilt auch für gesperrte Spieler ohne gültigen Code.
- **Löschprotokoll:** Jede Löschung schreibt eine Zeile in `account_deletions`: Zeitpunkt, Kanal (`web_code`, `in_game`, `admin`), „war gesperrt“ und ein HMAC der Spieler-ID (nur für Rückfragen „wurde Konto X gelöscht?“). Kein Name, keine Identität. Admin-Panel: Seite „Löschprotokoll“ (`GET /admin/account-deletions`, nur lesen, Zähler je Kanal).

**Haken für das Spiel (CP1):** Im Konto-Panel ein Knopf „Löschcode für die Website“ → `POST /me/deletion-code`, Code groß anzeigen (z. B. `ABCD-EFGH`) mit Ablaufzeit aus `expiresAt` und dem Hinweis auf `playsoulwick.com/delete-account`; bei `403 banned` den Hinweis auf die Support-Adresse zeigen. Dazu der Knopf „Konto jetzt löschen“ → `DELETE /me` (mit Rückfrage).

### 3.7a Bug-Meldungen aus dem Spiel (ENTSCHIEDEN, P-033; Zahlen TESTWERT)

Das Feedback-Werkzeug (heute F9, nur lokal) wird für alle Spieler zur **Bug-Meldung**: Der Spieler markiert Stellen auf einem Screenshot (Rechtecke mit kurzer Notiz, Freihand-Striche), schreibt eine Notiz und wählt Kategorien; das Spiel lädt alles mit `POST /bug-reports` hoch (Spieler-Session, auch Gastkonten). Admins und Moderatoren sehen die Meldungen im Admin-Panel, setzen den Status (`neu`, `gesehen`, `erledigt`, `wird nicht behoben`); löschen dürfen nur Admins.

- **Was gespeichert wird:** Spieler-ID (Fremdschlüssel), Zeitpunkt, Notiz, Kategorien, Markierungen und Striche (relative Koordinaten), Spiel-Kontext (z. B. Ort, Szene, Seed, Auflösung, Sprache; frei, ≤ 16 KiB), Spielversion, Plattform, der Screenshot (WebP/JPEG/PNG, ≤ 1,5 MiB, Typ aus den Magic Bytes) sowie Status, bearbeitender Admin und Zeitpunkt. **Keine** IP-Adresse, keine Geräte-ID, keine Store-ID in der Meldung. Der Kontext soll keine personenbezogenen Daten enthalten (keine Dateipfade mit Benutzernamen, keine fremden Namen).
- **Aufbewahrung:** 90 Tage ab Eingang (`BUG_REPORT_RETENTION_DAYS`, TESTWERT), dann automatisch gelöscht (`services/housekeeping.ts`: beim Start der API und danach alle 24 h).
- **Kontolöschung:** Die Meldungen gehen mit dem Konto (Kaskade), weil der Screenshot persönliche Daten zeigen kann (Spielername, Gildenname, Chat später). Die Lösch-Vorschau der Website nennt ihre Anzahl. Beim Zusammenführen zweier Konten (§3.6) wandern sie zum bleibenden Konto.
- **Schutz:** 10 Meldungen je Spieler und Stunde, 20 je IP und Stunde (TESTWERT), Body ≤ 2,25 MiB nur auf dieser Route, gesperrte Spieler `403 banned`.
- **Datenschutzerklärung (offen):** Die eRecht24-Erklärung braucht einen Zusatz „Fehlermeldungen aus dem Spiel“ (Zweck: Fehlerbehebung, Rechtsgrundlage berechtigtes Interesse bzw. Einwilligung durch aktives Absenden, Inhalt wie oben, 90 Tage, Löschung mit dem Konto); dazu die Store-Angaben (Google „Datensicherheit“: Absturz-/Diagnosedaten und Fotos/Screenshots, optional, nicht geteilt; Apple „App-Datenschutz“ entsprechend). Das Spiel sollte vor dem ersten Absenden einmal darauf hinweisen.

**Haken für das Spiel:** F9-Werkzeug um „Absenden“ erweitern: Screenshot als WebP (Godot `Image.save_webp_to_buffer`, Qualität ~0,8) oder JPEG, auf höchstens 1,5 MiB bringen (sonst verkleinern), `Marshalls.raw_to_base64`, Koordinaten durch Bildbreite/-höhe teilen, Striche auf ≤ 256 Punkte ausdünnen. Antworten: `201` → Danke-Hinweis; `429` → „Später erneut versuchen“ (`Retry-After`); `413`/`400 invalid_image` → kleiner bzw. als JPEG erneut; `403 banned` → Hinweis wie bei der Anmeldung. Ohne Anmeldung (offline) lokal speichern wie bisher.

### 3.8 Version-Sperre

- `GET /health` liefert zusätzlich `minGameVersion` und `protocolVersion` (P16).
- Das Spiel vergleicht beim Start: Ist die eigene Version älter als `minGameVersion`, sperrt das Hauptmenü die Online-Funktionen und zeigt „Bitte aktualisieren“; Einzelspieler bleibt spielbar.
- Der Relay lässt nur Spieler mit **gleicher** `protocolVersion` in einen Raum. `protocolVersion` ist eine ganze Zahl im Spiel und steigt, sobald sich Pakete, RPCs oder replizierte Eigenschaften ändern.
- Grund: Steam, Google und Apple geben Updates zeitversetzt frei; Crossplay funktioniert nur mit gleicher Protokollversion. `KNOWN_GAME_VERSIONS` bleibt für die Plausibilitätsprüfung der Run-Berichte.

## 4. Deployment

| Dienst | Wo | `production` | `development` |
| --- | --- | --- | --- |
| Website `soulwick-web` | Dokploy (VPS) | `playsoulwick.com` | `dev.playsoulwick.com` |
| API `soulwick-api` | Dokploy | `api.playsoulwick.com` | `api-dev.playsoulwick.com` |
| Admin-Panel `soulwick-admin` | Dokploy, zusätzlich geschützt | `admin.playsoulwick.com` | `admin-dev.playsoulwick.com` |
| Datenbank `soulwick-postgres` | Dokploy, nur intern | – | – |
| **Relay `soulwick-relay`** (neu) | Dokploy, eigene Application aus `apps/relay/Dockerfile`, Traefik leitet WebSockets durch | `play.playsoulwick.com` | `play-dev.playsoulwick.com` |
| Dedizierter Godot-Server (später) | erst Dokploy-Container-Pool, bei Bedarf Anbieter mit Regionen | – | – |
| Spiel-Builds | Steam (SteamPipe), Google Play Console, App Store Connect (alle zum Release, D-179); Browser auf Dokploy | Standard-Branch / Produktion | Steam-Beta-Branch / Play „Interner Test“ / TestFlight |

Domains sind ein **VORSCHLAG** (P-018) im Muster von P-008; Einrichtung Schritt für Schritt in [../infra/DOKPLOY.md](../infra/DOKPLOY.md). Jede Umgebung hat ihren eigenen Relay.

- **Relay auf Dokploy (P17):** Build-Kontext `.`, Port 8790, **genau eine Replica**, Healthcheck `GET /health`. Traefik reicht WebSocket-Upgrades ohne Zusatz durch; Zeitlimits für lange Verbindungen prüfen. `API_INTERNAL_URL` (interne Adresse der API: JWKS und Status; kein gemeinsames Geheimnis mehr, P-027), `RELAY_INTERNAL_KEY`, `PROTOCOL_VERSION`.
- **Umgebungen:** `development` (dev.-Domains, Steam-Beta-Branch, Play „Interner Test“) und `production`. Jede Umgebung hat eigene Datenbank und eigene Geheimnisse (P-008).
- **Spiel-Builds** bekommen ihre Umgebung **beim Export** (Feature-Tag `env_development`/`env_production` oder `online/environment.cfg`, gesetzt von `tools/export_build.ps1 -Env …` im Spiel-Repo); daraus folgt die API-URL. Die Relay-URL ist nicht fest im Spiel: Es nimmt `relayUrl` aus `GET /public/config` (`RELAY_PUBLIC_URL` der API), nur als Rückfall den Standard der Umgebung. Der Editor nutzt immer `localhost`; Argumente (`-- env=…`, `-- api=…`, `-- relay=…`) überschreiben alles. Das Hauptmenü zeigt die Version mit „dev“ in `development`. Details: [../infra/DOKPLOY.md](../infra/DOKPLOY.md) §1.
- **Traffic:** Der Relay schickt jedes Paket weiter (Host → Relay → Clients). Inklusivtraffic des VPS (Hetzner) beobachten; Metriken aus §2.6.

**Build-CI (Spiel-Repo, CP7, D-148):** GitHub Actions (`.github/workflows/release.yml`): Ein Tag `v<version>` baut Windows, Linux, macOS und Android als GitHub-Release. Mit den jeweiligen Secrets kommen dazu: Steam-Upload per `steamcmd` in einen Beta-Branch (`tools/steam/steam_upload.sh`), Google-Play-Bundle mit Upload in „Interner Test“ (`tools/ci/play_upload.sh`), iOS als signierte IPA mit TestFlight-Upload (`tools/ci/ios_build.sh`) und macOS signiert und notarisiert (`tools/ci/macos_sign.sh`); beides läuft auf dem macOS-Läufer der CI, ohne eigenen Mac. iOS gehört zum Release (D-179). Die Browser-Version baut Dokploy (`soulwick/docs/WEB_BUILD.md`); ein Export „Dedicated Server“ kommt erst mit dem dedizierten Server (später). Signaturschlüssel (Android-Keystore, Apple-Zertifikate, Steam-Login, Play-Dienstkonto) nur als GitHub-Secrets. Details: `soulwick/docs/RELEASE.md`, `soulwick/docs/STORES.md`.

## 5. Lokal testen (ohne Stores)

| Was | Wie |
| --- | --- |
| Dienste | `bun run services:up`, `bun dev` (API 3101, Relay 3103, Web 3100, Admin 3102; Postgres 5532; Browser-Version des Spiels 3110; P-035) |
| Vier Spieler auf einem PC | Godot-Editor *Debug → Ausführungsinstanzen anpassen* mit Argument `--player=1..4`; jede Instanz meldet sich per `/auth/dev` mit eigener Geräte-ID an und tritt per Raumcode bei |
| Gilden | Testdaten aus `bun run db:seed:dev`: „Dochtwächter“ `[DOCHT]` (Code `DOCHT2345`) und „Aschenrunde“ `[ASCHE]` (Code `ASCHE2345`); Seed-Spieler „Lumen“ (`dev-device-00000001`) ist in beiden, Gilden-Raum für ASCHE z. B. mit „Glutfunke“ (`dev-device-00000005`) testen |
| Handy (Android) | Ein-Klick-Export per USB, `adb reverse tcp:3101 tcp:3101` und `adb reverse tcp:3103 tcp:3103`; das Handy erreicht `localhost` des PCs ohne HTTPS-Umweg (unverschlüsseltes HTTP/WS im Debug-Export erlauben, prüfen) |
| Steam | Test-AppID 480 mit `steam_appid.txt`, Steam-Client offen; zwei Steam-Konten brauchen zwei Rechner |
| Schlechtes Netz | Relay-Optionen `--sim-latency` und `--sim-loss`, unter Windows zusätzlich „clumsy“ |
| Automatisch | Headless-Host und Headless-Client gegen den lokalen Relay als Smoke-Test (`tools/net_smoke.gd` im Spiel-Repo), `bun test` für das Relay-Protokoll |
| Echte Konten (Steam, Google) | in der Umgebung `development` mit Steam-Beta-Branch und Play „Interner Test“ |

## 6. Stores

### 6.1 Konten und Kosten (Publisher WebBude, ENTSCHIEDEN)

| Store | Kosten | Hinweise |
| --- | --- | --- |
| Steam (Steam Direct) | 100 USD je App | 30 Tage Wartezeit nach der Zahlung; Store-Seite mindestens 2 Wochen „Demnächst“ vor dem Release; Steuer- und Bankdaten von WebBude |
| Google Play Console | 25 USD einmalig | **Organisationskonto** (D-U-N-S-Nummer nötig); erspart die Testpflicht neuer Privatkonten (12 Tester über 14 Tage) |
| Apple Developer Program | 99 USD pro Jahr | vor dem Release nötig (D-179; D-U-N-S-Nummer, Vorlauf Tage bis Wochen); signiert und notarisiert auf dem macOS-Läufer der CI |
| Server | VPS mit Dokploy (vorhanden) | Relay-Traffic beobachten |

Stand der Preise: 14.10.2026, vor dem Bezahlen bei den Anbietern prüfen.

### 6.2 Steam

- Steamworks-Konto für WebBude, Steam Direct bezahlen, eigene AppID; Steuer- und Bankdaten.
- `STEAM_WEB_API_KEY` (Publisher-Schlüssel) und `STEAM_APP_ID` nur in Dokploy `production` bzw. für Tests in `development`.
- SteamPipe-Depots (Windows, Linux), Beta-Branch mit Passwort für Tests, Steam Playtest für Freunde.
- Store-Seite (DE/EN), Screenshots, Trailer, Altersfragebogen; Rich Presence für „Beitreten“.
- Optional Achievements; Steam Cloud **aus**, falls der Soulwick-Cloud-Save (CP5) kommt.

### 6.3 Google Play

- Organisationskonto, App anlegen, Play App Signing, Upload-Schlüssel nur in der CI.
- Play Games Services v2 einrichten (OAuth-Client für den Server, §3.3).
- Testspuren intern → geschlossen → offen → Produktion.
- Formular **„Datensicherheit“**: Spieler-ID, Name, Gilde, Run-Berichte, Relay-Verbindungsdaten; Link zur **Web-Seite für die Kontolöschung** (§3.7).
- IARC-Fragebogen; **Zielgruppe ab 13** angeben (sonst gelten die Familien-Richtlinien). Die Altersfreigabe ergibt sich aus dem Fragebogen (erwartet niedrig) und ist nicht die Zielgruppe (D-173).
- Nutzergenerierte Inhalte: Spieler- und Gildennamen melden und filtern (Admin-Panel kann umbenennen und sperren).
- Ziel-API-Level der aktuellen Anforderung von Google.

### 6.4 App Store

- Apple Developer Program für WebBude, Zertifikate und Profile, TestFlight.
- „App-Datenschutz“-Angaben, Altersfreigabe.
- Prüfregeln: Konto löschen in der App (5.1.1 (v)), Sign in with Apple nur bei Social-Login (4.8), keine Kauf-Links nach außen ohne Erlaubnis.
- Game Center einrichten (§3.4).

## 7. Was zusätzlich mitgedacht werden muss

1. **Rechte:** Vertrag mit dem Kollegen (Idee) und allen Mitwirkenden, dass WebBude veröffentlichen und verkaufen darf; Lizenzen aller Assets, Schriften, Audio-Dateien und Addons prüfen (MP10).
2. **Konten und Kosten:** siehe §6.1; Konten auf WebBude, nicht auf Privatpersonen.
3. **Touch und Handy:** Steuerung entschieden (zwei Sticks, Zielhilfe nur für Fernwaffen, D-155, D-168); offen sind Gerätetests und Leistung (CP2): Renderer von Forward+ auf **Mobile** für Android prüfen, Safe Areas, Auflösung (D-096 offen), Akku. App im Hintergrund = Host weg → Handy-Spieler möglichst nicht hosten lassen oder warnen.
4. **Eingabe-Abstraktion zuerst (MP1):** `player.gd` liest Tastatur und Maus direkt; ohne Eingabe-Objekt gibt es weder Netzwerk noch Touch noch Gamepad (Steam Deck).
5. **Versionen:** Crossplay heißt gleiche Protokollversion auf allen Stores; Update-Sperre im Hauptmenü, wenn zu alt (§3.8).
6. **Store-Pflichten:** Kontolöschung in der App **und** als Web-Seite (Google), Datenschutz-Angaben (Google „Datensicherheit“, Apple „App-Datenschutz“), IARC-Altersfreigabe, Melden und Filtern von Namen und Gildennamen, Zielgruppe in der Play Console **ab 13**.
7. **Datenschutz:** Datenschutzerklärung (eRecht24, P-013) um Steam-, Google- und Apple-IDs, Relay-Verbindungsdaten (IP, Spieler-ID, Zeitpunkt, keine Inhalte) und die Bug-Meldungen aus dem Spiel (Screenshot, Notiz, Kontext, 90 Tage, §3.7a, P-033) ergänzen. AGENTS.md Regel 6 („nur Steam-ID bzw. Geräte-ID“) wird dabei mit erweitert.
8. **Cheats:** Der Host meldet Runs; die Plausibilitätsprüfung bleibt. Ranglisten gegebenenfalls nur von PC-Hosts zählen oder später über den dedizierten Server.
9. **Betrieb:** Relay-Traffic beobachten (Inklusivtraffic), Monitoring, Backups, Status-Anzeige im Spiel bei Server-Ausfall (Einzelspieler bleibt offline spielbar).
10. **Geschäftsmodell (D-176, Arbeitsgrundlage):** Käufe nur Kosmetik und „Werbefrei“, am Konto serverseitig geprüft (Store-Quittungen, Steam-Ticket, D-177); Tabellen `purchases`/`entitlements` erst mit CP6. Preise OFFEN.

## 8. Offene Fragen

- Preise, Zahlungsweg im Browser und plattformübergreifende Käufe (D-176 OFFEN). Geschäftsmodell (D-176), Konto-Modell (D-121), Touch (D-168) und Store-Zielgruppe ab 13 (D-173) sind entschieden; die Altersfreigabe selbst kommt aus dem IARC-Fragebogen.
- Ranglisten je Plattform oder gemeinsam (CP0 Frage 7).
- Relay-Regionen (CP0 Frage 10) und ob Clients nur an den Host senden dürfen (§2.4).
- `rejoin` (§2.5): Darf ein getrennter Spieler in denselben Raum (gleiche Spieler-ID, ggf. alte Peer-ID) zurück, im Dorf und/oder im laufenden Run?
- Welches Godot-Plugin für Play Games Services v2 (§3.3).
- Domains und Port des Relays bestätigen (P-018).

**Weiterlesen:** [ROADMAP.md](ROADMAP.md) · [DECISIONS.md](DECISIONS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [PRD.md](PRD.md) · [TECHSTACK.md](TECHSTACK.md) · [../infra/DOKPLOY.md](../infra/DOKPLOY.md) · [../../soulwick/docs/ROADMAP_CROSSPLAY.md](../../soulwick/docs/ROADMAP_CROSSPLAY.md) · [../../soulwick/docs/ROADMAP_MULTIPLAYER.md](../../soulwick/docs/ROADMAP_MULTIPLAYER.md) · [../../soulwick/docs/DECISIONS.md](../../soulwick/docs/DECISIONS.md)
