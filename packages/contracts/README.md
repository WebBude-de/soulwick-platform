# `@soulwick/contracts`

Gemeinsame zod-Schemas und TypeScript-Typen für alle Anfragen und Antworten der Soulwick-API
(Spieler, Gilden, Runs, Ranglisten, Admin) sowie gemeinsame Enums (`RunMode`, `GuildRole`,
`AdminRole`, `LeaderboardKind`) und `API_VERSION`.

`src/lobby.ts` ist der Vertrag des Relays (`apps/relay`): Steuer-Nachrichten (JSON), Fehler- und
Close-Codes, Aufbau des Binärrahmens mit Testvektoren (`RELAY_FRAME_TEST_VECTORS`, auch für den
GUT-Test von `online/relay_peer.gd` im Spiel), `PROTOCOL_VERSION` und der interne API-Endpunkt
`GET /internal/relay/players/:playerId/status`. Ändert sich das Protokoll, `PROTOCOL_VERSION` im Spiel
und in der Relay-Umgebung gemeinsam erhöhen.

`src/identity.ts` enthält Plattform-Anmeldung (Google Play, Game Center), verknüpfte Identitäten,
Verknüpfungscodes und das Zusammenführen von Konten (D-121, D-122) sowie die automatische
Kontolöschung mit Einmal-Löschcode (P14, P15, P-026); das Löschprotokoll für das Admin-Panel steht in
`src/admin.ts`.
Das Konto-Profil (ein Charakter je Konto, P-034) steht in `src/common.ts` (`PlayerAppearance`,
`PlayerCharacter`) und `src/player.ts` (`UpdateProfileRequest` für `PATCH /me`).
`src/xp.ts` enthält Konto-XP und Level (D-188, KF3): die Level-Kurve `xpForLevel` / `levelForXp` /
`accountLevel` (50·L·(L−1)), die XP eines Runs `runXp` (Werte `XP_VALUES`, Koop-Bonus, Deckel; alles
TESTWERT) und `POST /me/xp` (`AddXpRequest`, `AddXpResponse`). Spiel und Server rechnen mit denselben
Funktionen; der GDScript-Client spiegelt sie. `PlayerLevel` (in `src/common.ts`) ist die Level-Zahl in
`GuildMember`, `LeaderboardEntry`, `GuildRoom`, `RoomPeer` und `RelayPlayerStatus`.
`src/world.ts` enthält die Cloud-Welten (D-188, KF8, P-038): Blob `WorldData` (Spielstand v5 als JSON,
je ConfigFile-Abschnitt ein Objekt), `WorldSummary`, `WorldMeta` / `CloudWorld`, `PutWorldRequest` mit
`baseRevision`, `discarded` (Sicherung der unterlegenen Seite) und `resolvedMerges`,
`WorldConflictResponse` (409 mit Server-Stand), Sicherungen (`WorldBackup*`), Archiv
(`RestoreWorldRequest`/`Response`) und die Grenzen (`MAX_CLOUD_WORLDS`, `WORLD_MAX_DATA_BYTES`, 30 Tage;
TESTWERT). Gemischt wird im Spiel (`meta/save_merge.gd`, KF9), nie auf dem Server.
`src/bug-report.ts` enthält die Bug-Meldungen aus dem Spiel (`POST /bug-reports` mit Screenshot,
Markierungen und Kategorien; `kind` unterscheidet „bug“ (Standard) und „idea“) und ihre Admin-Routen
samt Grenzen (`BUG_REPORT_MAX_*`, P-033; Filter `?kind=bug|idea`).
`PublicConfig` und die Felder `minGameVersion`/`protocolVersion` in `HealthResponse` (`src/common.ts`)
melden die Umgebung an Spiel-Builds (P16); `PublicConfig.supportEmail` ist die Support-Adresse der
Website (P-026).

Das Paket wird **als TypeScript-Quelltext** genutzt (kein eigener Build): API und Relay laden es
direkt mit Bun, die Next.js-Apps übersetzen es über `transpilePackages`.

Bei Änderungen an Anfragen/Antworten zuerst hier anpassen, dann API, Relay und Apps. Bei inkompatiblen
Änderungen `API_VERSION` erhöhen. `bun run --cwd packages/contracts typecheck` prüft das Paket (alles
zusammen: `bun run typecheck`), `bunx biome check packages/contracts` Lint und Formatierung.
