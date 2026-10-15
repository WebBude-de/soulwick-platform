# ARCHITECTURE – Soulwick Platform

> **Stand:** 15.10.2026 (Bun/Turbo/Prisma nach ROADMAP P7/P8, Relay P13, Better Auth P19/P-027) · Gegenstück zu `soulwick/docs/ARCHITECTURE.md` (Spiel). Hier: Server, Website, Admin-Panel. Anforderungen: [PRD.md](PRD.md) · Technik: [TECHSTACK.md](TECHSTACK.md) · Entscheidungen: [DECISIONS.md](DECISIONS.md).

## 1. Systemgrenzen

```text
Spiel (Godot, Host-Modell)          Browser                              eRecht24 (Rechtstexte-API v2)
   │ HTTPS, Bearer-Token               │ HTTPS                                 │ Pull (API- + Plugin-Key)
   ▼                                   ▼                                       ▼
┌───────────────┐   ┌──────────────┐  ┌──────────────┐                 ┌───────────────┐
│ soulwick-api  │◄──│ soulwick-web │  │soulwick-admin│──► soulwick-api │ soulwick-api  │
│ Hono auf Bun  │   │ Next.js, i18n│  │ Next.js      │   (/admin,      │ /legal/*      │
└──────┬────────┘   └──────────────┘  └──────────────┘    Admin-Token) └───────────────┘
       │   ▲ intern: Gilden- und Sperrstatus
       ▼   └─────────────────────┐
┌──────────────────┐   ┌─────────┴────────┐
│soulwick-postgres │   │  soulwick-relay  │  Bun + WebSocket (P-016): Räume mit Raumcode,
│ PostgreSQL 17    │   │  play.<domain>   │  leitet Spielpakete weiter, prüft das Spieler-JWT (JWKS der API, P-027)
└──────────────────┘   └────────▲─────────┘
                                │ WSS (Host-Spieler und Clients: PC, Android, später iOS)
                           Spiel (Godot)
```

- **Echtzeit-Spielverkehr nur über den Relay, Spiellogik nur im Spiel** (D-119, P-016; gebaut in ROADMAP P13, Betrieb P17): Koop läuft im Host-Modell, die Pakete gehen über `soulwick-relay`, der sie nicht liest. Die API sieht weiter nur Anmeldung, Gilden, Run-Berichte, Ranglisten, Rechtstexte und beantwortet dem Relay intern Gilden- und Sperrstatus. Steam ist nur Zusatz für Anmeldung und Einladungen (P-017). Details: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md).
- **Das Spiel bleibt ohne Server spielbar.** Jeder Aufruf aus dem Spiel ist optional und darf scheitern.
- Website und Admin-Panel rufen die API **serverseitig** auf (Next.js Server Components/Actions). Browser sprechen die API nicht direkt an, deshalb ist CORS auf `CORS_ORIGINS` beschränkt.
- **Die Website baut und läuft ohne API und ohne eRecht24**: fehlende Daten werden als Hinweis bzw. Platzhalter gerendert, nie als Fehlerseite.

## 2. Verzeichnisstruktur

| Pfad | Verantwortung |
| --- | --- |
| `packages/contracts/src/` | zod-Schemas und Typen je Bereich (`common`, `player`, `guild`, `run`, `leaderboard`, `admin`, `legal`, `identity`, `lobby` für den Relay), `API_VERSION`, `PROTOCOL_VERSION`. **Einzige Quelle** für Request-/Response-Formen und Relay-Nachrichten. |
| `packages/db/` | `@soulwick/db`: `prisma/schema.prisma`, `prisma/migrations/` (versioniert, nie nachträglich ändern), `prisma.config.ts`, `src/index.ts` (Prisma-Client mit `adapter-pg`), `scripts/db-status.ts`, `scripts/verify-migrations.ts`. Nur `apps/api` importiert dieses Paket. |
| `packages/config/` | gemeinsame TypeScript-Konfiguration (`tsconfig/base.json`, `tsconfig/bun.json`, wie DapItUp). |
| `apps/relay/src/` | WebSocket-Relay auf Bun (P-016): `index.ts`/`server.ts` (Start, `/health`, `/metrics`, WebSocket unter `/v1`), `config.ts` (Umgebungsvariablen), `relay.ts`/`rooms.ts` (Räume, Weiterleitung, Moderation), `internal.ts` (interne HTTP-Endpunkte für die API, P-024), `auth.ts` (Spieler-JWT gegen die JWKS der API mit Schlüssel-Cache, P-027; Status-Cache), `limits.ts`, `metrics.ts`, `protocol.ts`. Tests in `apps/relay/test/`. |
| `apps/api/src/app.ts` | Erzeugt die Hono-App aus `Deps` (db, config, injizierbare `fetch`/`now` für Tests); Middleware-Kette; Routen einhängen. |
| `apps/api/src/index.ts` | Prozessstart auf Bun: `.env` laden, Prisma-Client, `Bun.serve`, sauberes Beenden. Migrationen laufen davor im Container-Start (`prisma migrate deploy`). |
| `apps/api/src/config.ts` | Umgebungsvariablen lesen und validieren (zod), inklusive `ERECHT24_*`. |
| `apps/api/src/auth/` | Better Auth (P-027): `auth.ts` (Instanz mit Prisma-Adapter, Plugins `admin`, `bearer`, `jwt`; Handler nicht gemountet), `player-plugin.ts` (eigenes Plugin `soulwickPlayerAuth`: Plattform-Identität prüfen, Spieler finden/anlegen, Session). |
| `apps/api/src/middleware/auth.ts` | `requirePlayer`, `optionalPlayer`, `requireAdmin`, `requireRole(role)`: Better-Auth-Session aus dem Bearer-Token lesen (Spieler: Rolle `player` + `player_id`; Admins: Rolle `admin`/`moderator`, nicht gesperrt), Sperre prüfen, `last_seen_at` pflegen. |
| `apps/api/src/routes/` | HTTP-Schicht: Eingaben mit Verträgen validieren, Services rufen, Antwort formen. `routes/admin/` getrennt. `routes/legal.ts`: `GET /legal/:type` (P-025). |
| `apps/api/src/services/` | Fachlogik ohne HTTP: Gilden, Ranglisten, Sperren, Plausibilität, Audit, Passwörter (argon2id für Better Auth), `sessions.ts` (Spieler-Sessions, Relay-JWT, Plugin-Callbacks), `admin-users.ts` (Admin-Login/-Logout, Admin-Konten), Steam, `identities.ts` (Spieler über Provider-Identität finden/anlegen), `legal.ts` (Abruf bei Bedarf, Speicher-Cache 24 h / Fehler 60 s, P-025). |
| `apps/api/src/lib/` | Querschnitt: Fehler (`ApiError`), Logger, Rate-Limit, `tokens.ts` (nur noch das Bestätigungstoken der Website-Löschung, HS256), `secrets.ts` (HMAC-Schlüssel aus `BETTER_AUTH_SECRET` abgeleitet), Einladungscodes, Client-IP, `erecht24/` (HTTP-Client für die Rechtstexte-API v2 über `Deps.fetch`, Datums- und HTML-Hilfen, `sanitize.ts` bereinigt das HTML nach Allowlist mit Bun-`HTMLRewriter`). |
| `apps/api/src/scripts/` | `create-admin.ts`, `seed-dev.ts` (Testdaten für lokal und Dokploy-`development`; idempotent, verweigert `NODE_ENV=production`). Migrationen laufen über die Prisma CLI in `packages/db`. |
| `apps/api/test/` | `bun test` gegen den Docker-Postgres: Wegwerf-Datenbank je Lauf, `prisma migrate deploy`, `Deps` mit festem `now` und gemocktem `fetch`. |
| `apps/web/src/app/` | Seiten mit englischen Pfaden für beide Sprachen: `/`, `leaderboards`, `guilds/[tag]`, `delete-account`, `imprint`, `privacy`; Sprache per Cookie `NEXT_LOCALE` (P-012). |
| `apps/web/messages/{de,en}/*.json` | Alle Texte der Website je Sprache (`common`, `landing`, `leaderboards`, `guilds`, `legal`, `deletion`). |
| `apps/web/public/brand/` | Website-Grafiken vom Projektmitglied (WebP; Liste in der dortigen README, Briefing `soulwick/docs/SPRITES_V5.md` §8); fehlt eine Datei, zeigt die Seite einen Platzhalter. |
| `apps/web/public/sprites/` | Spiel-Sprites als verlustfreies WebP, erzeugt von `apps/web/scripts/sprites.ts` aus `../soulwick/art/`; versioniert, damit der Build ohne Spiel-Repo läuft. |
| `apps/admin/src/app/` | `/login` und die Panel-Seiten unter `(panel)/`: Übersicht, `statistik`, `spieler`, `gilden`, `runs`, `live-raeume`, `loeschungen` (Löschprotokoll), `protokoll`, `admins` (die Seite „Rechtstexte“ entfällt mit P-025). `actions.ts`: Server Actions. `lib/session.ts`: httpOnly-Cookie. `proxy.ts`: ohne Cookie → `/login`. |
| `infra/` | Nur lokale Dienste: `docker-compose.yml` mit Postgres (Port 5432; kein Objektspeicher, weil nichts Dateien speichert). Die Apps laufen lokal über `bun dev` und auf Dokploy getrennt aus ihren Dockerfiles. Betrieb: [infra/DOKPLOY.md](../infra/DOKPLOY.md). |

## 3. Datenmodell (PostgreSQL, Prisma)

| Tabelle | Inhalt |
| --- | --- |
| `players` | id (uuid), `name`, `created_at`, `last_seen_at`. **Ohne** `steam_id`/`device_id` (→ `player_identities`, P-014). |
| `player_identities` | id, `player_id` (→ `players`, Kaskade), `provider` (Enum `steam` / `device` / `google_play` / `game_center`), `provider_user_id`, `created_at`, `last_used_at`; eindeutig über (`provider`, `provider_user_id`); mehrere Identitäten je Spieler. Verknüpfen per Code, Zusammenführen (D-122) und Entkoppeln über `/me/link-code`, `/me/link`, `/me/identities` (P15). |
| `bans` | Spieler, Grund, `created_by_admin_id`, `expires_at` (null = dauerhaft), `revoked_at`, `revoked_by` |
| `guilds` | Name, Kürzel (2–5), Einladungscode, Gründer, `created_at`, `disbanded_at` |
| `guild_members` | Gilde, Spieler (eindeutig → höchstens eine Gilde), Rolle `founder` / `officer` / `member`, `joined_at` |
| `guild_progress` | je Gilde: Kasse, Schmiede-Stufen (jsonb), `version` für optimistische Sperre |
| `runs` | Modus, Gilde?, erreichter Raum, Dauer, Seed, Spielversion, `reported_by`, `flagged`, `flag_reason` |
| `run_players` | Teilnehmer je Run |
| `auth_users` | Better-Auth-Nutzer (P-027): Admins/Moderatoren (E-Mail, Rolle `admin` / `moderator`, `banned` = deaktiviert, `disabled_at`) und je Spieler eine Zeile mit Rolle `player`, `player_id` (→ `players`, Kaskade, eindeutig) und Platzhalter-E-Mail auf `.invalid`; ersetzt `admin_users` (Migration `better_auth`, gleiche IDs) |
| `auth_sessions` | Sessions (Token, `expires_at`, `user_id` → `auth_users`, Kaskade); keine IP-Adressen |
| `auth_accounts` | Anmeldewege je Nutzer; Admins: `provider_id = credential` mit argon2id-Hash im Feld `password` |
| `auth_verifications` | Better-Auth-Prüfwerte (E-Mail-Bestätigung, Passwort-Reset; noch ungenutzt) |
| `auth_jwks` | Signierschlüssel der Spieler-JWTs (Ed25519, privater Teil mit `BETTER_AUTH_SECRET` verschlüsselt, Rotation über `expires_at`) |
| `audit_log` | Admin (`admin_id` → `auth_users`), Aktion, Zieltyp, Ziel-ID, Details (jsonb), Zeitpunkt |
| `player_notes` | Moderations-Notizen (P-023): `player_id` (→ `players`, Kaskade), `admin_id` (→ `auth_users`, bei Löschung null), `text`, `created_at`; nur im Admin-Panel sichtbar |
| `link_codes` | Verknüpfungscode je Spieler (D-121): nur HMAC (`code_hash`), `expires_at`; Kaskade mit dem Spieler |
| `deletion_codes` | Einmal-Löschcode je Spieler (P-026): nur HMAC (`code_hash`), `expires_at` (15 min), `failed_attempts`; ein neuer Code ersetzt die Zeile samt ID; Kaskade mit dem Spieler |
| `account_deletions` | Löschprotokoll (P-026): `deleted_at`, `channel` (`web_code` / `in_game` / `admin`), `was_banned`, `player_hash` (HMAC der Spieler-ID, nur für Rückfragen); **kein Name, keine Identität**, kein Fremdschlüssel |

Regeln: Eindeutigkeit von Gildenname und Kürzel gilt nur für aktive Gilden (P-101). Löschen eines Spielers (`DELETE /me`, Website, Admin; eine gemeinsame Funktion) entfernt das Konto, seine Identitäten, Codes, Sperren, Notizen und seine Mitgliedschaft (Gründerrolle nach P-102); Run-Teilnahmen werden anonymisiert; jede Löschung schreibt eine Zeile in `account_deletions`. Die Tabelle `account_deletion_requests` wurde mit der Migration `automatic_account_deletion` entfernt (P-026). Vertragsfelder `steamId` (Spieler, Admin) und `hasDeviceId` (Admin) werden aus `player_identities` abgeleitet, bis der Vertrag ein `identities`-Feld ergänzt. Rechtstexte liegen in keiner Tabelle mehr: `legal_documents` und `erecht24_push_clients` wurden mit der Migration `drop_legal_cache` entfernt (P-025); alte `audit_log`-Zeilen mit `legal.*` bleiben lesbar (`action` ist Text).

## 4. Wichtige Abläufe

**Anmeldung (Spiel, P-027):** `POST /auth/device` (Gast je Gerät ohne Schlüssel, Schalter `GUEST_AUTH_ENABLED`, eigene Rate-Limits je IP, P-028) bzw. `POST /auth/dev` (nur mit `DEV_AUTH_ENABLED` und passendem `x-dev-auth-key`) bzw. `POST /auth/steam` (Web-API-Ticket, `AuthenticateUserTicket`) bzw. `POST /auth/google-play` (Server-Auth-Code, Spieler-ID nur von Google) → dünne Hono-Route validiert den Body → Better-Auth-Plugin `soulwickPlayerAuth` (`auth.api.signInPlayer`): Identität prüfen, in `player_identities` suchen, Spieler finden oder neu anlegen, Sperre prüfen (`403 banned`), Better-Auth-Nutzer des Spielers (Rolle `player`) finden oder anlegen, Session mit Laufzeit `PLAYER_TOKEN_TTL_DAYS` → `{token, expiresAt, player}`; `token` ist das signierte Session-Token. Jeder weitere Aufruf: `Authorization: Bearer <token>` (Plugin `bearer`). Für den Relay holt das Spiel `GET /auth/token` (JWT, 15 min, `jwt`-Plugin; öffentliche Schlüssel unter `GET /auth/jwks`). `game_center` folgt mit iOS (Route antwortet 501). Mehrere Identitäten je Spieler werden per Verknüpfungscode zusammengeführt (D-121, D-122, P14/P15).

**Jeder authentifizierte Aufruf:** Session zum Bearer-Token aus der Datenbank lesen (kein Cookie-Cache; abgelaufene, beendete oder gelöschte Sessions → `401 unauthorized`) → aktive Sperre prüfen → bei Sperre `403 {error:"banned", reason, expiresAt}` → sonst Route. Das Spiel zeigt die Sperre an und läuft offline weiter.

**Gilden-Fortschritt (Kasse, Schmiede):** `GET` liefert Werte + `version`. `PATCH` sendet neue absolute Werte + gelesene `version`; stimmt sie nicht mehr, antwortet die API `409 version_conflict` mit dem aktuellen Stand, der Client rechnet neu. So gibt es kein doppeltes Abbuchen bei gleichzeitigen Käufen.

**Run-Bericht:** Host sendet `POST /runs` (Modus, Teilnehmer ≤ 4, Raum, Dauer, Seed, Spielversion). Prüfungen: Host ist Teilnehmer; Gilden-Run nur von Mitgliedern; Plausibilität (Mindestsekunden je Raum `MIN_SECONDS_PER_ROOM`, bekannte Versionen `KNOWN_GAME_VERSIONS`) → verdächtige Runs werden mit `flag_reason` **markiert**, nicht abgelehnt.

**Ranglisten:** `GET /leaderboards/:kind` (`solo`, `group`, `guild`) mit `period=all|season`, `season=YYYY-MM`, `limit`. Sortierung: höchster Raum, dann kürzere Dauer; Gleichstand = gleicher Rang. Markierte Runs und Runs mit aktuell gesperrten Teilnehmern fehlen. Mit Spieler-Token zusätzlich die eigene Position.

**Admin (P-027):** `POST /admin/auth/login` (E-Mail, Passwort; 10/min je IP) → Better Auth `signInEmail` (argon2id über `Bun.password`) → `{token, expiresAt, admin}` mit Session-Token, Laufzeit `ADMIN_TOKEN_TTL_HOURS` fest ab Login. Das Admin-Panel legt es in ein httpOnly-Cookie (`soulwick_admin`) und ruft die API nur serverseitig mit `Authorization: Bearer`; der Browser sieht das Token nie. `POST /admin/auth/logout` beendet die Session. Rolle und Sperrstatus kommen bei jedem Aufruf aus `auth_users`; Deaktivieren löscht alle Sessions des Kontos sofort. Spieler-Sessions erreichen keine Admin-Route (Rolle `player`), Admin-Sessions keine Spieler-Route. Jede schreibende Admin-Aktion erzeugt einen `audit_log`-Eintrag.

**Konto löschen (P-026, vollautomatisch):** *Im Spiel* `DELETE /me` (Kanal `in_game`). *Website* ohne Anmeldung: Spiel ruft `POST /me/deletion-code` (8 Zeichen, 15 min, einmal; nur HMAC gespeichert) → Website `POST /account-deletion/verify {playerName, code}` (5/h je IP, höchstens 5 falsche Codes je Spielername, sonst Code verbrannt; jeder Fehler `400 invalid_deletion_code`) → Bestätigungstoken (10 min, HS256 mit aus `BETTER_AUTH_SECRET` abgeleitetem Schlüssel, P-027, Claims Spieler-ID + Code-Zeilen-ID) und Anzeige (Name, Gilde, Runs) → `POST /account-deletion/confirm {token}` löscht in einer Transaktion zuerst die Code-Zeile (bedingt, damit zwei Bestätigungen nicht beide gewinnen), dann das Konto (Kanal `web_code`, auch gesperrt, `was_banned` markiert). *Admin* `DELETE /admin/players/:id` (Kanal `admin`, plus `audit_log`). Lesen: `GET /admin/account-deletions` (Zeitraum, Kanal, Spieler-ID über denselben HMAC; Zähler je Kanal). Logzeile `account_deleted` nur mit Kanal und `wasBanned`, ohne Spieler-ID. Support-Adresse für Spieler ohne Spielzugang: `SUPPORT_EMAIL` → `GET /public/config` `supportEmail`.

**Admin-Statistik (P-023):** `GET /admin/stats` (Summen plus 24-h-/7-Tage-Werte) und `GET /admin/stats/daily?days=…` (≤ 90, je UTC-Tag neue Spieler, Runs, aktive Spieler = Run-Teilnehmer; Raum-Verteilung und Dauer ohne markierte Runs) rechnen nur aus vorhandenen Tabellen; es gibt keine Anmelde-Historie und keine personenbezogenen Listen.

**Live-Räume (P-024):** Admin-Panel → API `GET /admin/relay/rooms`, `POST /admin/relay/rooms/:code/close|kick` → Relay `GET /internal/rooms`, `POST /internal/rooms/:code/close|kick` (Header `x-relay-key`, `RELAY_INTERNAL_URL`). Der Relay schließt mit `room_closed` (`closed_by_admin`, ergänzter Grund, `PROTOCOL_VERSION` bleibt 1) bzw. kickt mit den vorhandenen Nachrichten (`room_closed kicked`, `peer_left kicked`, Host gekickt → andere `host_left`); die API schreibt danach `relay.room_close` bzw. `relay.kick` ins Protokoll. Relay nicht erreichbar → `502 relay_unavailable`, nicht konfiguriert → `501 relay_not_configured`. **Sperre:** `POST /admin/players/:id/bans` ruft danach best effort `POST /internal/players/:id/ban`; der Relay leert den Status-Cache des Spielers und trennt seine Verbindungen mit `banned` (4003).

**Rechtstexte (P-013, Umsetzung wie DapItUp nach P-025):**

1. *Abruf:* `GET /legal/:type` holt bei Bedarf `GET <ERECHT24_API_URL>/imprint|privacyPolicy|privacyPolicySocialMedia` mit den Headern `eRecht24-api-key` und `eRecht24-plugin-key`. Ohne **beide** Schlüssel antwortet die API sofort `status: "missing"` (ohne Aufruf bei eRecht24).
2. *Cache im Speicher* (je API-Container, je Typ): Erfolg 24 h, Fehler 60 s; eine laufende Anfrage wird von parallelen Aufrufen geteilt. Hat eRecht24 den Text noch nicht (404) oder ist das HTML nach der Bereinigung leer, gilt `status: "missing"` (ebenfalls 60 s). Schlägt ein Nachladen fehl, liefert die API den letzten guten Text weiter; gab es noch keinen, antwortet sie `502` mit `erecht24_unavailable`, `erecht24_unauthorized`, `erecht24_bad_response` oder `erecht24_bad_request`. Nach einem Neustart wird beim ersten Aufruf neu geholt.
3. *Bereinigung:* `html.de`/`html.en` werden nach Allowlist neu aufgebaut (`p`, `h2`–`h4`, Listen, Tabellen, `strong`/`em`/`b`/`i`, `br`, `hr`, `a[href]` nur mit http(s), mailto, tel; führendes `<h1>` entfällt). `warnings` kommen als Textzeilen.
4. Keine Push-Clients, keine Tabelle, keine Admin-Funktionen (P-025). Neue Texte erscheinen spätestens nach 24 h (bzw. nach einem Neustart der API).
5. *Website:* `/imprint` und `/privacy` rendern `html[locale]` aus der API-Antwort. Bei `missing`, fehlender Sprache oder nicht erreichbarer API erscheint ein deutlicher Platzhalter („Text folgt“) statt eines Fehlers; die Seite baut ohne API.

**Website i18n (P-012):** `next-intl` ohne i18n-Routing. `src/i18n/request.ts` liest die Sprache aus dem Cookie `NEXT_LOCALE`, sonst aus `Accept-Language` (Deutsch → `de`), sonst `en`. Der Sprachumschalter setzt Cookie und `localStorage` und lädt die Seite neu; `src/proxy.ts` leitet nur alte `/de/...`- und `/en/...`-Links auf die Pfade ohne Präfix um. Texte in `messages/{de,en}/*.json`.

**Website allgemein:** Server-Rendering mit `apiGet`; schlägt die API fehl (`unreachable` oder Fehlerstatus), rendert die Seite eine Hinweisbox statt eines Fehlers. Build braucht keine laufende API (dynamische Seiten). Bilder ausschließlich WebP (P-015), Pixel-Art mit `image-rendering: pixelated`; Sprite-Animationen als CSS-`steps()` über die Streifen aus `public/sprites/`.

## 5. Betrieb

- Lokal: `bun dev` startet API (8787), Web (3000), Admin (3001) und Relay (8790) als Prozesse, `infra/docker-compose.yml` nur Postgres. Dokploy: je Umgebung getrennte Dienste aus den Dockerfiles der Apps: `soulwick-postgres`, `soulwick-api` (8787), `soulwick-web` (3000), `soulwick-admin` (3001), `soulwick-relay` (8790). Web und Admin erreichen die API über das Docker-Netz (`API_URL` = interne Adresse der API, z. B. `http://soulwick-api-prod:8787`); Einrichtung in [infra/DOKPLOY.md](../infra/DOKPLOY.md).
- **Relay (P13 gebaut, Betrieb P17, P-016, P-018):** eigene Dokploy-Application aus `apps/relay/Dockerfile`, Domain `play.playsoulwick.com` bzw. `play-dev.playsoulwick.com`, WebSocket unter `/v1`, Traefik reicht WebSockets durch. Genau eine Replica, weil Räume nur im Speicher liegen; ein Neustart schließt alle Räume (für die Spieler wie ein Host-Abbruch), dauerhafte Daten gibt es keine. Variablen: `PROTOCOL_VERSION` gleich wie die API, `API_INTERNAL_URL` (interne Adresse der API, Pflicht: JWKS unter `/auth/jwks` für das Spieler-JWT, P-027) und `RELAY_INTERNAL_KEY` (gleich wie die API) für den Sperr- und Gildenstatus; kein Geheimnis der API, `TRUST_PROXY=true`. Logs ohne Paketinhalte, `/health` und `/metrics` (nur mit `x-relay-key`: Räume, Spieler, Bytes/s), interne Moderations-Endpunkte unter `/internal/` (nur mit `x-relay-key`, P-024); die API erreicht sie über `RELAY_INTERNAL_URL` (interne Adresse des Relays). Den Traffic des VPS beobachten.
- **Images (P-009):** API und Relay auf `oven/bun:1.3.14` (Install mit `--frozen-lockfile`, bei der API `prisma generate` im Build); Web und Admin bauen mit Bun auf `node:24-slim` und laufen als Next standalone unter Node. Build-Kontext immer die Repo-Wurzel.
- **Migrationen:** Das API-Image führt vor dem Start `prisma migrate deploy` aus und startet dann die API (`exec bun …`), genau eine Replica (P-003, P-008). Lokal: `bun run db:migrate --name <name>` beim Entwickeln, `bun run db:deploy` zum reinen Anwenden. Hinter Traefik `TRUST_PROXY=true` (P-005).
- `GET /health` meldet `status`, `apiVersion`, `db`, `time`, `minGameVersion` und `protocolVersion` (P16, für die Update-Sperre im Spiel und die Versionsprüfung im Relay); bei DB-Fehler 503. `GET /public/config` meldet dieselben Versionen, `relayUrl` (`RELAY_PUBLIC_URL`), `supportEmail` (`SUPPORT_EMAIL`, P-026) und `guestAuth` (P-028).
- **Umgebung im Spiel-Build:** Das Spiel wählt `development` oder `production` beim Export (Feature-Tag `env_*` bzw. `online/environment.cfg`), daraus folgt die API-URL; die Relay-URL holt es aus `GET /public/config`, der Editor nutzt immer localhost ([infra/DOKPLOY.md](../infra/DOKPLOY.md) §1).
- Logs als JSON-Zeilen auf stdout (Dokploy sammelt sie).
- Geheimnisse ausschließlich als Umgebungsvariablen (Dokploy); im Repo nur `.env.example`. Die eRecht24-Schlüssel liegen nur bei der API (`ERECHT24_API_KEY`, `ERECHT24_PLUGIN_KEY`), nie im Web-Build.

## 6. Schnittstelle zum Spiel

- Der GDScript-Client (Spiel-Repo, MP7) spricht nur Routen, die in `packages/contracts` definiert sind. Änderungen beginnen dort (Vertrag → API → Spiel).
- Abwärtskompatibilität: Felder nur ergänzen; Brüche erhöhen `API_VERSION`, das Spiel vergleicht beim Start mit `/health`.
- Der Server unterstützt mindestens die aktuelle und die vorige Spielversion (`KNOWN_GAME_VERSIONS`).
- Die Umstellung auf Prisma und `player_identities` ändert den Vertrag **nicht**; `/auth/dev` und `/auth/steam` antworten wie bisher.
- Better Auth (P-027) ändert die Form der Antworten nicht, aber den Inhalt von `token` (Session-Token statt JWT; alte Tokens gelten nicht mehr) und `hello.token` am Relay (JWT aus `GET /auth/token`, neu).

## 7. Nicht final spezifiziert

- **Crossplay-Konten (D-108, CP0/CP1):** Soulwick-Konto, an das Steam-, Google-Play-Games-, Game-Center- und Geräte-Identitäten geknüpft werden; Verknüpfungscode (wie Among Us), Konto löschen in-App (Store-Pflicht). Plattform-Seite gebaut (P14/P15, 14.10.2026); im Spiel fehlen noch Konto-Panel und Plattform-Logins (CP1).
- **Relay-Server (CP3):** mit D-119 entschieden (P-016), gebaut (P13), Betrieb auf dem Server noch offen (P17); Protokoll und Betrieb in [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md), Pakete P13 und P17. Offen: Regionen und ob Clients nur an den Host senden dürfen.
- **Geschäftsmodell (CP6, OFFEN):** mobil kostenlos + PC bezahlt (wie Among Us) oder überall kostenlos mit Kosmetik; Tabellen `purchases`/`entitlements` erst danach.
- Rate-Limit über mehrere API-Instanzen.
- Gilden-Wappen, Gilden-Schmiede-Werte (P4, zusammen mit dem Spiel, nach MP0 und CP0).
- Server-Teil der KI-Wunschbosse (OFFEN, siehe Spiel-Repo `KONZEPT_KI_BOSS.md`).
