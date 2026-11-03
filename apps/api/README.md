# Soulwick API (`@soulwick/api`)

## Zweck

HTTP-API für alles, was **nicht** Echtzeit ist: Konten, Gilden, Gildenfortschritt (Kasse + Schmiede),
Run-Berichte, Ranglisten, Rechtstexte, Kontolöschung (Website und Spiel) und der Admin-Bereich. Echtzeit-Spiel läuft im
Host-Modell über den Relay (`apps/relay`); die API beantwortet ihm nur intern Sperr- und Gildenstatus.
Das Spiel muss ohne Server funktionieren (Einzelspieler, Schnelles Spiel).

Technik: Hono auf Bun (`Bun.serve`), Prisma + PostgreSQL über `@soulwick/db` (`packages/db`),
zod-Schemas aus `@soulwick/contracts`, **Better Auth** (P-027) für Spieler- und Admin-Sitzungen
(Session-Token als `Authorization: Bearer`, Plugins `admin`, `bearer`, `jwt`, eigenes Plugin
`soulwickPlayerAuth` in `src/auth/`), Admin-Passwörter mit argon2id (`Bun.password`). Der Better-Auth-
Handler ist nicht gemountet: Jeder Auth-Pfad ist eine Hono-Route, die `auth.api` aufruft.

## Start (lokal)

```bash
bun install                                          # im Repo-Wurzelordner
bun run services:up                                  # lokale Dienste (infra/docker-compose.yml: Postgres soulwick-postgres)
cp .env.example .env                           # gemeinsame Werte (Wurzel): BETTER_AUTH_SECRET, DEV_AUTH_KEY …
cp apps/api/.env.example apps/api/.env         # Werte nur der API
bun run db:deploy                                    # Migrationen anwenden (neue Migration: bun run db:migrate --name <name>)
bun run db:seed                                      # Basis-Seed: Admin aus DEFAULT_ADMIN_EMAIL/-PASSWORD (siehe unten)
bun run db:seed:dev                                  # Testdaten (siehe unten)
bun run dev:api                                      # http://localhost:3102/health
bun run services:down                                # Dienste stoppen (Daten bleiben im Volume)
```

**Logs lokal:** in der Konsole Zeilen im Stil von Next.js
(`05:07:35.600 ⚠ GET /admin/me 401 in 1ms  ip=::1 code=unauthorized`), dazu Dateien in
`logs/api/<YYYY-MM-DD>/` (`all.log` zum Lesen, `all.jsonl` und je Stufe `error.jsonl` …; 7 Tage).
Mehr sehen: `LOG_LEVEL=debug` in der Wurzel-`.env`. Gemeinsamer Logger: `packages/logger`.

Ist Port 5532 belegt, in `infra/.env` `DB_PORT=<freier Port>` setzen und den Port in
`DATABASE_URL` (Wurzel-`.env`) anpassen. Benutzer, Passwort und Datenbankname kommen aus
`POSTGRES_*` in `infra/.env` (Standard `soulwick` / `soulwick-local-only` / `soulwick`).

## Basis-Seed (Start-Admin)

`bun run db:seed` (Root) bzw. `bun run --cwd apps/api seed` (`src/scripts/seed.ts`, wie `seed` in
DapItUp) ist für **jede** Umgebung gedacht und **idempotent**. Er legt den Admin aus
`DEFAULT_ADMIN_EMAIL` und `DEFAULT_ADMIN_PASSWORD` an (Rolle `admin`, Protokoll `admin.create` mit
`source: "seed"`), **nur wenn es diese E-Mail noch nicht gibt**:

- Ein vorhandenes Konto mit der Adresse wird **nie** verändert (kein Passwort-Reset, keine
  Rollenänderung, kein Wiederaktivieren), auch wenn die Variablen gesetzt bleiben.
- Wurde die Adresse unter „Mein Konto“ geändert (Protokoll `admin.email_change` mit dieser Adresse
  als `from`), legt der Seed sie **nicht** neu an, sondern warnt nur.
- Fehlen beide Variablen: nur ein Hinweis, Exit 0. Ist eine ungültig (E-Mail nach `AdminEmail`,
  Passwort mind. 12 Zeichen) oder ist in `NODE_ENV=production` das Passwort der lokale Standard
  `soulwick-admin-local`: Warnung, nichts angelegt, Exit 0. Nur unerwartete Fehler (z. B. Datenbank
  nicht erreichbar) enden mit Exit 1.
- Das **API-Image** führt den Basis-Seed bei jedem Start nach `prisma migrate deploy` aus; schlägt er
  fehl, startet die API trotzdem (Fehler im Log).

**Nach dem ersten Login** das Passwort im Admin-Panel unter „Mein Konto“ ändern und
`DEFAULT_ADMIN_PASSWORD` aus der Umgebung entfernen (die E-Mail darf stehen bleiben).
**Notfall** (kein Admin kommt mehr hinein): `DEFAULT_ADMIN_EMAIL` auf eine **neue**, noch nicht
vorhandene Adresse setzen, `DEFAULT_ADMIN_PASSWORD` dazu, Container neu starten; danach wie oben.
Mit Zugriff auf die Datenbank geht es direkter: `ADMIN_NEW_PASSWORD=<neu> bun run db:admin:password <email>`
(im Container `bun apps/api/src/scripts/admin-password.ts <email>`). Sonst setzt ein anderer Admin im
Panel unter „Admins“ das Passwort neu oder legt einen Zugang an. Ein Zurücksetzen per E-Mail gibt es
nicht (kein Mailversand).

Lokal nutzen Basis-Seed und Dev-Seed dieselben Variablen (`apps/api/.env.example`:
`admin@soulwick.local` / `soulwick-admin-local`): Beide legen dasselbe Konto an, keiner setzt das
Passwort des anderen zurück.

## Entwicklungsdaten (Dev-Seed)

`bun run db:seed:dev` (Root) bzw. `bun run --cwd apps/api seed:dev` legt an, was Website und
Admin-Bereich lokal zum Anzeigen brauchen:

| Was | Inhalt |
| --- | --- |
| Admin-Zugänge | `admin@soulwick.local` (Rolle `admin`), `moderator@soulwick.local` (`moderator`); neue Zugänge bekommen das Passwort aus `DEFAULT_ADMIN_PASSWORD` (mind. 12 Zeichen), Standard `soulwick-admin-local`; vorhandene behalten ihres |
| Spieler | 10 Testspieler mit Geräte-IDs `dev-device-00000001` … `dev-device-00000010` (9 und 10 erst vor wenigen Tagen angelegt, für „neue Spieler“) (je eine Identität `device`; „Lumen“ zusätzlich eine erfundene Steam-ID `76561190000000001`); damit funktioniert `POST /auth/dev` (z. B. `{ "name": "Lumen", "deviceId": "dev-device-00000001" }`) als dieser Spieler |
| Gilden | „Dochtwächter“ `[DOCHT]`, Einladungscode `DOCHT2345`, 4 Mitglieder (Gründer Lumen, Offizier, 2 Mitglieder), Gildenkasse 1250 und Schmiede-Stufen; „Aschenrunde“ `[ASCHE]`, Code `ASCHE2345`, 4 Mitglieder (Gründer Glutfunke, **Lumen als Offizier**, 2 Mitglieder), Kasse 420. Lumen ist damit in zwei Gilden (D-147) |
| Runs | 20 Runs (`solo`, `quick`, `guild`) über die aktuelle und die vorige Saison, Seeds `dev-seed-01` … `dev-seed-20`; einer ist markiert (`too_fast`), zwei Spieler teilen sich einen Rang; dazu 15 Runs über die letzten zwei Wochen (`dev-seed-21` … `dev-seed-35`, davon ein Gilden-Run der „Aschenrunde“) für die Admin-Statistik |
| Notiz | eine Moderations-Notiz des Moderators zu „Sternasche“ (P-023) |
| Aussehen | Spieler 1–8 bekommen eine feste Figur mit Farben (`appearance`, P-034), 9 und 10 behalten die Standardfigur (`null`); gesetzt wird nur, solange kein Aussehen gespeichert ist |
| Konto-XP | 218 Runs mit XP (D-188) für Spieler 1–9 (feste Run-IDs `5eed0000-…`, gerechnet wie `POST /me/xp`), damit Level, Gefahrenstufe und Rang in Gilde, Rangliste und Admin sichtbar sind: Glutfunke Level 12, Lumen 10 (Kerze I) … Funkenflug 2; Rauchquarz ohne XP (Level 1). Jeder Run läuft auf der Gefahrenstufe, die das Konto davor hatte (D-194, XP mit Gefahr-Bonus). `players.xp` wird bei jedem Lauf als Summe der Einträge neu gesetzt |
| Konto-Zustand | Lumen (KF3b): 3 Talente (6 Punkte), Zauber `light_flash`, 4 Gesehen-Merker; nur angelegt, solange keiner gespeichert ist. Zum Ausprobieren: Login als Lumen, `GET /me/state` |
| Cloud-Welten | 3 Welten von Lumen (D-188, KF8; feste Welt-IDs `5eed0001-…`): „Glutwald“ (heute gespielt) und eine Welt ohne eigenen Namen aktiv, „Alte Welt“ im Archiv (noch 25 Tage); je Welt eine Sicherung (`merge`). Zum Ausprobieren: Login als Lumen, `GET /me/worlds` |
| Bug-Meldungen | 4 Meldungen (P-033) von Lumen, Glutfunke, Wachsherz und Aschkralle mit Platzhalter-Screenshots (PNG-Verläufe 480×270, kein echtes Bild), Markierungen, Strichen und Ort; drei Fehler (zwei `new`, eine `seen` vom Moderator) und eine Idee (`kind: idea`, `new`) |
| Löschprotokoll | 4 Einträge (Website, im Spiel, Admin; zwei davon „war gesperrt“) über die letzten zwei Wochen, ohne Namen (P-026) |
| Sperre | Spieler „Sternasche“ für 7 Tage gesperrt (durch den Moderator); seine Runs fehlen in den Ranglisten, seine Anmeldung liefert `403 banned` |
| Protokoll | Einträge `admin.create`, `player.ban` und `player.note_add`, damit die Protokoll-Seite gefüllt ist |

Der Seed ist **idempotent**: Jeder Datensatz hat einen festen Schlüssel (E-Mail, Geräte-ID,
Gilden-Kürzel, Run-Seed, Sperrgrund, Notiztext, ID der Löschprotokoll-Zeile bzw. der Bug-Meldung, XP-Run-ID). Ein zweiter Lauf ergänzt nur Fehlendes und überschreibt keine
Änderungen aus dem Admin-Bereich (auch die Passwörter vorhandener Zugänge bleiben, z. B. nach
„Mein Konto“).
Komplett neu aufsetzen: `bun run db:reset` (löscht die lokale Datenbank, spielt alle Migrationen und den
Seed neu ein). Nur auf ausdrücklichen Wunsch – Agenten setzen die Datenbank des Projektmitglieds nie zurück.

Der Seed **verweigert `NODE_ENV=production`**. Im Docker-Image ist er nur für die Dokploy-Umgebung
`development` gedacht: `NODE_ENV=development DEFAULT_ADMIN_PASSWORD=<eigenes> bun apps/api/src/scripts/seed-dev.ts`
(siehe [infra/DOKPLOY.md](../../infra/DOKPLOY.md)).

## Umgebungsvariablen

| Variable | Pflicht | Standard | Bedeutung |
| --- | --- | --- | --- |
| `DATABASE_URL` | ja | – | PostgreSQL-Verbindung (lokal `postgres://soulwick:soulwick-local-only@localhost:5532/soulwick`); Wurzel-`.env`; auch Prisma CLI und Tests lesen sie dort |
| `TEST_DATABASE_URL` | nein | `DATABASE_URL` | Nur Tests: Postgres-Server für die Wegwerf-Datenbanken `soulwick_test_<zufall>` |
| `BETTER_AUTH_SECRET` | ja | – | Better Auth (P-027): signiert Session-Tokens, verschlüsselt die JWT-Signierschlüssel; daraus abgeleitet der HMAC-Schlüssel für Verknüpfungs- und Löschcodes (≥ 32 Zeichen, je Umgebung, nur API) |
| `BETTER_AUTH_URL` | nein | `http://localhost:3102` | Öffentliche Basis-URL der API (Aussteller `iss` der Relay-JWTs); in production `https://…` Pflicht |
| `PORT` | nein | `3102` | HTTP-Port (das Docker-Image setzt 8787) |
| `PLAYER_TOKEN_TTL_DAYS` | nein | `30` | Gültigkeit einer Spieler-Session ab Anmeldung (ohne Verlängern) |
| `ADMIN_TOKEN_TTL_HOURS` | nein | `8` | Gültigkeit einer Admin-Session ab Anmeldung (ohne Verlängern) |
| `DEV_AUTH_ENABLED` | nein | `false` | Testphasen-Login `POST /auth/dev` erlauben |
| `DEV_AUTH_KEY` | wenn Dev-Login an | – | Muss im Header `x-dev-auth-key` mitgeschickt werden (≥ 16 Zeichen) |
| `GUEST_AUTH_ENABLED` | nein | `true` | Gast-Anmeldung je Gerät `POST /auth/device` ohne Schlüssel (P-028); `false` = `403 guest_auth_disabled` |
| `GUEST_LOGINS_PER_MINUTE` | nein | `10` | TESTWERT: `POST /auth/device` je IP und Minute |
| `GUEST_ACCOUNTS_PER_HOUR` | nein | `20` | TESTWERT: neue Gastkonten je IP und Stunde (Anmeldungen bekannter Geräte zählen nicht) |
| `STEAM_WEB_API_KEY`, `STEAM_APP_ID` | nein | – | Steam-Login (Publisher-Schlüssel); ohne beide antwortet `/auth/steam` mit `501 provider_not_configured` |
| `STEAM_TICKET_IDENTITY` | nein | `soulwick` | Identity-String, den das Spiel an `GetAuthTicketForWebApi` übergibt |
| `GOOGLE_PLAY_CLIENT_ID`, `GOOGLE_PLAY_CLIENT_SECRET` | nein | – | Web-OAuth-Client für Play Games Services (Server-Auth-Code); ohne beide antwortet `/auth/google-play` mit 501 |
| `EXTERNAL_AUTH_TIMEOUT_MS` | nein | `8000` | TESTWERT: Zeitlimit je Aufruf bei Steam/Google/Apple/Discord und beim Mail-Worker |
| `WEB_URL` | nein | `http://localhost:3100` | Öffentliche Website (KF5): das Spiel öffnet `<WEB_URL>/login/<code>`, Magic Links zeigen auf `<WEB_URL>/login/magic`, die Browser-Abläufe enden auf `<WEB_URL>/login/…`; in production `https://…` Pflicht |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | nein | – | Google-Anmeldung im Browser (OAuth-Client „Webanwendung“, Weiterleitungs-URI `<BETTER_AUTH_URL>/auth/oauth/google/callback`); nur zusammen; leer = aus |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | nein | – | Discord-Anmeldung im Browser (OAuth2-App, Redirect `<BETTER_AUTH_URL>/auth/oauth/discord/callback`); nur zusammen; leer = aus |
| `APPLE_CLIENT_ID` | nein | – | Sign in with Apple im Browser: Services ID (Return URL `<BETTER_AUTH_URL>/auth/oauth/apple/callback`); braucht den Schlüssel unten |
| `APPLE_APP_BUNDLE_ID` | nein | – | Sign in with Apple in der iOS-App (`POST /auth/apple`, Zielgruppe des Identity-Tokens); leer = aus |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | nein | – | Schlüssel für Sign in with Apple (`.p8`, PEM; `\n` statt Zeilenumbrüchen erlaubt); nur zusammen; damit signiert die API das Client-Secret, holt Refresh-Tokens und widerruft sie beim Löschen |
| `STEAM_OPENID_ENABLED` | nein | `false` | Steam-Anmeldung im Browser über OpenID 2.0 (kein Schlüssel nötig; dieselbe `steam`-Identität wie das Ticket) |
| `GAME_CENTER_BUNDLE_IDS` | nein | leer | Bundle-IDs der iOS-App für `POST /auth/game-center`, kommagetrennt; leer = `501 provider_not_configured` |
| `MAIL_ADAPTER` | nein | `off` | Mailversand der Magic Links (D-196): `off` (keine Magic Links, 501), `log` (nur Entwicklung: die Mail steht im API-Log), `cloudflare` (HTTPS an den Mail-Worker) |
| `MAIL_FROM` | bei `cloudflare` | leer | Absender, z. B. `Soulwick <login@playsoulwick.com>` |
| `MAIL_CLOUDFLARE_URL`, `MAIL_CLOUDFLARE_KEY` | bei `cloudflare` | leer | Adresse und Schlüssel (≥ 32 Zeichen, `Authorization: Bearer`) des Cloudflare-Mail-Workers; Vertrag siehe „Anmeldung für Spieler“ |
| `LOGIN_ATTEMPTS_PER_MINUTE` | nein | `20` | TESTWERT: Anmeldeversuche je IP und Minute (`/auth/password`, `/auth/apple`, `/auth/game-center`, `/auth/web-login`, Browser-Abläufe, Magic-Link-Bestätigung, `/me/logins`) |
| `PASSWORD_FAILURES_PER_USERNAME` | nein | `10` | TESTWERT: Fehlversuche je Benutzername in 15 min, danach `429` (gleich für bekannte und unbekannte Namen) |
| `MAGIC_LINKS_PER_HOUR` | nein | `10` | TESTWERT: Magic-Link-Mails je IP und Stunde (`429`) |
| `MAGIC_LINKS_PER_ADDRESS_PER_HOUR` | nein | `3` | TESTWERT: Magic-Link-Mails je Adresse und Stunde; darüber still nicht gesendet (gleiche Antwort) |
| `CORS_ORIGINS` | nein | leer | Erlaubte Browser-Origins, kommagetrennt |
| `RATE_LIMIT_PER_MINUTE` | nein | `120` | TESTWERT: Anfragen je IP und Minute (Admin-Login: 10) |
| `LINK_ATTEMPTS_PER_MINUTE` | nein | `10` | TESTWERT: `POST /me/link` je IP und Minute (Verknüpfungscodes nicht erratbar) |
| `DELETION_REQUESTS_PER_HOUR` | nein | `5` | TESTWERT: `POST /account-deletion/verify` je IP und Stunde (P-026; zusätzlich höchstens 5 falsche Codes je Spielername) |
| `BUG_REPORTS_PER_HOUR` | nein | `10` | TESTWERT: `POST /bug-reports` je Spieler und Stunde (P-033; jeder angemeldete Versuch zählt) |
| `BUG_REPORTS_PER_IP_PER_HOUR` | nein | `20` | TESTWERT: `POST /bug-reports` je IP und Stunde (mehrere Spieler hinter einer IP) |
| `WORLD_WRITES_PER_HOUR` | nein | `120` | TESTWERT: Schreibzugriffe auf Cloud-Welten (`PUT`, `DELETE`, Wiederherstellen, aus dem Archiv holen unter `/me/worlds`) je Konto und Stunde (D-188, P-038) |
| `BUG_REPORT_RETENTION_DAYS` | nein | `90` | TESTWERT: Bug-Meldungen werden so viele Tage nach dem Eingang automatisch gelöscht (beim Start der API und dann alle 24 h) |
| `TRUST_PROXY` | nein | `true` | Client-IP aus `X-Forwarded-For` (hinter Dokploy/Traefik); lokal `false` (`.env.example`) |
| `MIN_SECONDS_PER_ROOM` | nein | `8` | TESTWERT: schnellere Runs werden markiert |
| `KNOWN_GAME_VERSIONS` | nein | leer | Bekannte Spielversionen, kommagetrennt; leer = keine Prüfung |
| `MIN_GAME_VERSION` | nein | leer | Älteste Spielversion mit Online-Funktionen (z. B. `1.0.0`), in `/health` und `/public/config`; leer = keine Grenze (P16) |
| `PROTOCOL_VERSION` | nein | `1` | Netzwerk-Protokollversion der Umgebung; gleicher Wert wie beim Relay derselben Umgebung (P16) |
| `RELAY_PUBLIC_URL` | nein | leer | Öffentliche WebSocket-URL des Relays (z. B. `wss://play-dev.playsoulwick.com`, ohne Pfad wird `/v1` ergänzt) für `/public/config`; leer = kein Relay gemeldet |
| `SUPPORT_EMAIL` | nein | leer | Support-Adresse für Kontolöschung ohne Spielzugang; über `GET /public/config` als `supportEmail` (leer = `null`, Website zeigt nichts; P-026) |
| `LOG_LEVEL` | nein | `info` | `debug`, `info`, `warn`, `error` oder `silent`; Anfragen mit 2xx/3xx auf `info`, 4xx auf `warn` (mit Fehlercode `code`), 5xx auf `error` |
| `LOG_FORMAT` | nein | `pretty`, in `production` `json` | `pretty` = eine lesbare Zeile (Farben nur im Terminal, `NO_COLOR` schaltet sie ab), `json` = eine JSON-Zeile je Eintrag |
| `LOG_DIR` | nein | lokal `<repo>/logs`, in `production` keine Dateien | Log-Dateien unter `<LOG_DIR>/api/<YYYY-MM-DD>/`: `all.jsonl`, `all.log` (lesbar) und je Stufe `debug/info/warn/error.jsonl`; `off` = keine Dateien |
| `LOG_RETENTION_DAYS` | nein | `7` | TESTWERT: so viele Tagesordner bleiben (heute mitgezählt), ältere löscht der Wechsel auf einen neuen Tag |
| `RELAY_INTERNAL_KEY` | nein | leer | Gemeinsamer Schlüssel mit dem Relay (≥ 32 Zeichen) für `GET /internal/relay/players/:playerId/status` (Header `x-relay-key`, liefert Name, Sperre, Gilde) und für die Gegenrichtung (Live-Räume, P-024); leer = Endpunkt aus (404) |
| `RELAY_INTERNAL_URL` | nein | leer | Interne Adresse des Relays derselben Umgebung (z. B. `http://soulwick-relay:8790`, lokal `http://localhost:3103`) für `/admin/relay/*` und den Kick nach einer Sperre (P-024); braucht `RELAY_INTERNAL_KEY`; leer = `501 relay_not_configured`, Sperren ohne Relay-Kick |
| `RELAY_INTERNAL_TIMEOUT_MS` | nein | `3000` | TESTWERT: Zeitlimit je Aufruf an den Relay |
| `ERECHT24_API_KEY` | nein | leer | Projekt-Schlüssel der eRecht24 Rechtstexte-API v2 (P-025); ohne ihn oder ohne `ERECHT24_PLUGIN_KEY` meldet `GET /legal/:type` `missing`, die Website zeigt den Platzhalter |
| `ERECHT24_PLUGIN_KEY` | nein | leer | Plugin-/Entwickler-Schlüssel von eRecht24 (Header `eRecht24-plugin-key`); wie bei DapItUp Pflicht für den Abruf |
| `DEFAULT_ADMIN_EMAIL` | nein | leer | Basis-Seed (`db:seed`, jeder Container-Start): E-Mail des Start-Admins; nur angelegt, solange es die Adresse nicht gibt, nie überschrieben |
| `DEFAULT_ADMIN_PASSWORD` | nein | leer (Dev-Seed: `soulwick-admin-local`) | Basis-Seed: Passwort des Start-Admins (≥ 12 Zeichen; in production nicht der lokale Standard); nach dem ersten Login unter „Mein Konto“ ändern und die Variable entfernen. Dev-Seed: Passwort neu angelegter Zugänge `admin@soulwick.local` und `moderator@soulwick.local` |

## Anmeldung für Spieler (KF5, D-188, P-036, P-037, P-039)

Verträge: `packages/contracts/src/login.ts` (dazu `IdentityProvider` und `IdentitySummary.label` in
`identity.ts`, `LoginMethod` und `PublicConfig.loginMethods` in `common.ts`). Welche Arten eine
Umgebung anbietet, meldet `GET /public/config` (`loginMethods`); ohne ihre Variablen ist eine Art aus.

- **Konto-Modell (P-037):** `player_identities` ist die einzige Liste der Anmeldungen. Passwort-Hash
  (`credential`) und die Zeilen von Google, Apple, Discord liegen in `auth_accounts`, verbunden über
  `player_identities.auth_account_id`; die per Magic Link bewiesene Adresse steht in `auth_users.email`
  des Spielers. Nichts wird über eine gleiche E-Mail verknüpft; Social-Logins fragen nur die
  Nutzer-ID ab (Google `openid`, Discord `identify`, Apple ohne Scope) und speichern keine Namen
  oder Adressen.
- **Benutzername + Passwort:** `PUT /me/logins/password` (anlegen oder ändern, die Sitzung ist der
  Nachweis), `POST /auth/password`. Benutzername privat, 3–24 Zeichen `a-z 0-9 . _ -`, Passwort ≥ 10.
- **Web-Anmeldung aus dem Spiel:** `POST /auth/web-login` (`intent` `sign_in` oder mit Sitzung
  `link`) → `code`, `pollSecret`, `url` (`<WEB_URL>/login/<code>`); das Spiel fragt
  `POST /auth/web-login/poll` alle 2 s und bekommt die Sitzung genau einmal. Die Website liest
  `GET /auth/web-login/:code` und schickt den Browser zu `GET /auth/oauth/:provider/start?code=…`
  (`google`, `apple`, `discord`, `steam` = Steam OpenID) oder sendet `POST /auth/magic-link`.
  Rückrufe an die API (`/auth/oauth/:provider/callback`) leiten auf `<WEB_URL>/login/<code>` zurück
  (`?error=…` bzw. `?confirm=…`). Haben beide Konten Fortschritt, bestätigt **der Browser** das
  Zusammenführen (`POST /auth/web-login/confirm-merge`), nicht das Spiel.
- **Magic Link:** Mail mit `<WEB_URL>/login/magic?token=…` (15 min, einmal) und dem Code der Anfrage;
  die Seite zeigt `GET /auth/magic-link/preview` und löst erst per Knopf `POST /auth/magic-link/verify`
  aus (Mail-Scanner öffnen nur Links).
- **Im Spiel hinzufügen:** `POST /me/logins` mit Steam-Ticket, Play-Games-Code, Apple-Identity-Token,
  Game-Center-Signatur oder Geräte-ID eines Gastkontos; leere Konten gehen still auf, sonst
  `409 account_has_progress` bis `confirmMerge: true` (wie `POST /me/link`).
- **Apple:** Refresh-Tokens liegen verschlüsselt (AES-256-GCM, Schlüssel aus `BETTER_AUTH_SECRET`)
  in `auth_accounts`; Löschen des Kontos oder Trennen von Apple stellt sie in
  `oauth_token_revocations` ein, die API widerruft sie sofort und wiederholt Fehlschläge im
  Housekeeping.
- **Mail-Worker (`MAIL_ADAPTER=cloudflare`):** `POST <MAIL_CLOUDFLARE_URL>` mit
  `Authorization: Bearer <MAIL_CLOUDFLARE_KEY>` und JSON `{ from, to, subject, text, html }`; jede
  2xx-Antwort heißt angenommen. Lokal reicht `MAIL_ADAPTER=log` (Link im API-Log).
- **Dev-Seed:** Lumen hat Benutzername `lumen` mit Passwort `soulwick-player-local` und die Adresse
  `lumen@soulwick.test`.

## Befehle

| Befehl | Was passiert |
| --- | --- |
| `bun run dev:api` (oder `bun run --cwd apps/api dev`) | Entwicklungsserver mit Neustart bei Änderungen (`bun --watch`) |
| `bun test apps/api` | Tests gegen den Docker-Postgres (je Lauf eine Wegwerf-Datenbank mit allen Migrationen, `test/helpers.ts`); braucht `bun run services:up`. Ganzes Repo: `bun test` |
| `bun run --cwd apps/api typecheck` | TypeScript prüfen (Root: `bun run typecheck`, erzeugt vorher den Prisma-Client) |
| `bun run db:migrate --name <name>` | Neue Migration aus `packages/db/prisma/schema.prisma` erzeugen und lokal anwenden (Ordner `packages/db/prisma/migrations/`, mit committen) |
| `bun run db:deploy` | Vorhandene Migrationen auf `DATABASE_URL` anwenden (wie beim Start des Images) |
| `bun run db:status` / `bun run db:verify` | Zustand der Datenbank ansehen / alle Migrationen in einer Wegwerf-Datenbank prüfen |
| `bun run db:generate` | Prisma-Client erzeugen (läuft vor `typecheck` und `build` automatisch) |
| `bun run db:seed` (oder `bun run --cwd apps/api seed`) | Basis-Seed: Start-Admin aus `DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD`, nur wenn die Adresse fehlt (idempotent, jede Umgebung) |
| `bun run db:seed:dev` (oder `bun run --cwd apps/api seed:dev`) | Entwicklungsdaten einspielen (idempotent, nicht in Produktion) |
| `ADMIN_NEW_PASSWORD=<neu> bun run db:admin:password <email>` (oder `bun run --cwd apps/api admin:password`) | Notfall: Passwort eines Admin-Kontos direkt in der Datenbank setzen (mind. 12 Zeichen, nur aus der Variable, nie als Argument), beendet dessen Sitzungen, Protokoll `admin.password_reset` mit `source: "script"`; ohne E-Mail listet es die Admin-Konten (E-Mail, Rolle, deaktiviert). Sonst setzt ein Admin im Panel unter „Admins“ das Passwort neu (`POST /admin/admins/:id/password`) |

Lint und Formatierung laufen für das ganze Repo aus dem Root: `bun run fix`, `bun run check`. Einen
Build-Schritt gibt es nicht: Die API startet direkt aus der Quelle (`bun src/index.ts`).

Docker: `docker build -f apps/api/Dockerfile -t soulwick-api .` (aus dem Repo-Wurzelordner). Das Image
führt **beim Start** `prisma migrate deploy` und den Basis-Seed (`src/scripts/seed.ts`) aus und
startet dann die API; deshalb genau eine Replica. Im Container (Arbeitsordner `/app`, nur
Entwicklungsumgebung): `NODE_ENV=development bun apps/api/src/scripts/seed-dev.ts`.
Betrieb auf dem Server: [infra/DOKPLOY.md](../../infra/DOKPLOY.md).

## Endpunkte (Kurzüberblick)

Spieler (Header `Authorization: Bearer <token>`):

- `GET /health` (mit `minGameVersion`, `protocolVersion`), `GET /public/config` (`apiVersion`, `minGameVersion`, `protocolVersion`, `relayUrl`, `supportEmail`, `guestAuth`, `loginMethods`)
- `POST /auth/dev`, `POST /auth/device` (Gast, P-028), `POST /auth/steam`, `POST /auth/google-play`, `POST /auth/game-center`,
  `POST /auth/password`, `POST /auth/apple` (iOS-App):
  Antwort `{token, expiresAt, player}`, `token` = Better-Auth-Session-Token (30 Tage) für `Authorization: Bearer`
- Web-Anmeldung und „Anmeldung hinzufügen“ (KF5): siehe Abschnitt „Anmeldung für Spieler“
- `GET /auth/token` (Bearer, nur Spieler): `{token, expiresAt}`, JWT für `hello.token` am Relay (EdDSA,
  15 min, Claims `sub` = Spieler-ID, `name`, `iat`, `exp`, `iss`, `aud` = `soulwick-relay`);
  `GET /auth/jwks` (öffentlich): Schlüssel dazu
- `GET /me`, `PATCH /me` (`{ name?, appearance? }`, Konto-Profil P-034, siehe unten), `DELETE /me`, `GET /me/identities`, `DELETE /me/identities/:provider`, `POST /me/link-code`,
  `POST /me/link` (Konten verknüpfen nach D-121/D-122), `POST /me/deletion-code` (Einmal-Löschcode),
  `POST /me/xp` (Konto-XP je Run-ID genau einmal, D-188: `{entries: XpEntry[]}` → je Eintrag
  `credited` / `duplicate` / `flagged` / `deferred` und `account` mit `xp`, `level`; Rechnung mit
  `runXp()` aus dem Vertrag, Deckel 2 000 je Run und 20 000 je UTC-Tag, TESTWERT). `PlayerSelf` trägt
  `xp`, `level`, `levelStartXp`, `nextLevelXp`, `xpToNextLevel`; Gildenmitglieder, Ranglisten-Einträge,
  Gildenräume und der Relay-Status tragen `level`. Seit KF3b (D-194, D-196) trägt `XpEntry` optional
  `danger` (XP × (1 + 0,05 · G), G bis 30 zählt), und `PlayerSelf`, Gildenmitglieder, Gildenräume und
  der Relay-Status tragen `danger` und `rank` (Ranglisten: `danger` und `dangerRank`), abgeleitet aus
  Level und den letzten 5 nicht markierten XP-Einträgen (`rank.ts`)
- Konto-Zustand (D-194, KF3b; Vertrag `account-state.ts`): `GET /me/state` (Talente, ausgerüstete
  Zauber, Gesehen-Merker, dazu nur lesend Level, Talentpunkte, Gefahrenstufe, Rang und die letzten Runs),
  `PUT /me/state` (Talente + Zauber + `changedAt` zusammen: zuletzt geändert gewinnt, Zeitstempel aus der
  Zukunft auf Serverzeit gekappt; `seen` wird vereinigt; `409 talent_points_exceeded` über Level − 1,
  `409 seen_limit_reached` über 512 Merker, `413` über 64 KB; TESTWERT). Zusammenführen: die später
  geänderte Ausstattung bleibt, Merker vereinigt; Löschen löscht den Zustand mit
- Cloud-Welten (D-188, KF8, P-038; Vertrag `world.ts`): `GET /me/worlds` (aktive Welten und Archiv),
  `GET` / `PUT` / `DELETE /me/worlds/:worldId` (Revision über `baseRevision` oder `If-Match: "<n>"`,
  Antwort mit `ETag`; veralteter Stand → `409 revision_conflict` mit dem Server-Stand, das Spiel mischt
  und lädt erneut hoch; `DELETE` archiviert, `?permanent=true` löscht), `POST /me/worlds/:worldId/unarchive`,
  `GET /me/worlds/:worldId/backups`, `GET …/backups/:backupId`, `POST …/backups/:backupId/restore`.
  Höchstens 3 aktive Welten (die am längsten nicht gespielte geht ins Archiv), Blob ≤ 64 KB, Sicherungen und
  Archiv 30 Tage (alles TESTWERT); Aufräumen im Housekeeping
- `POST /account-deletion/verify`, `POST /account-deletion/confirm` (öffentlich, Lösch-Seite der Website, P-026)
- Gilden (D-147, P-031; bis 5 Gilden je Spieler, TESTWERT): `GET /me/guilds`, `POST /guilds`,
  `POST /guilds/join`, `GET /guilds/:id`, `POST /guilds/:id/leave`,
  `DELETE /guilds/:id/members/:playerId`, `PATCH /guilds/:id/members/:playerId` (`{role}`, nur Gründer),
  `POST /guilds/:id/invite-code` (Gründer, Offizier), `GET /guilds/:id/progress`,
  `PATCH /guilds/:id/progress` (Versionsprüfung, 409 bei Konflikt). Fehler: `403 not_member`,
  `403 forbidden_role`, `409 guild_limit_reached`, `409 guild_full`, `409 already_member`,
  `404 invalid_invite_code`, `404 member_not_found`, `400 cannot_target_self`, `409 guild_name_taken`,
  `409 guild_tag_taken`. Die alten Routen `/guilds/me*` und `POST /guilds/leave` gibt es seit
  `API_VERSION` 1.1.0 nicht mehr (404).
- `GET /guilds/:id/rooms` (nur Mitglieder, sonst `403 not_member`): offene Gildenräume dieser Gilde
  auf dem Relay mit freiem Platz (`GuildRoomList`; laufende Runs mit `started: true`), älteste zuerst.
  Fragt den Relay über `RELAY_INTERNAL_URL`/`RELAY_INTERNAL_KEY`; ist er nicht eingerichtet oder nicht
  erreichbar, antwortet die Route `200` mit `relayAvailable: false` und leerer Liste (Fehler im Log
  `relay_guild_rooms_failed`). Namen kommen aktuell aus der Datenbank.
- `POST /runs` (Gilden-Run mit `endReason` und `remainingGold` zahlt in die Gildenkasse, P-032:
  Portal 100 %, sonst 50 % aufgerundet; Antwort zusätzlich `guildPayout`, `guildProgress`). Optionale
  `reportId` (UUID je Run): dieselbe ID erneut → `200` mit dem gespeicherten Ergebnis, keine zweite
  Auszahlung; fremde ID → `409 report_id_conflict`
- `GET /leaderboards/:kind?period=all|season&season=YYYY-MM&limit=50` (`solo`, `group`, `guild`; öffentlich, mit Token zusätzlich `own`)
- `GET /public/guilds/:tag` (öffentlich, für die Webseite)
- `POST /bug-reports` (P-033, auch Gastkonten): Bug-Meldung aus dem Spiel mit Screenshot, siehe
  „Bug-Meldungen“ unten

Gesperrte Spieler erhalten auf jeder angemeldeten Route `403 {"error":"banned","reason","expiresAt"}`.

Admin (Präfix `/admin`, Session-Token eines Admins oder Moderators als Bearer; Spieler-Sessions → 401):
`POST /admin/auth/login` (`{token, expiresAt, admin}`, 8 h), `POST /admin/auth/logout` (204), `me`, „Mein Konto“ (siehe unten), `stats`, Spieler, Gilden, Runs,
Löschprotokoll (`account-deletions`, nur lesen), Protokoll (`audit`), Admin-Zugänge, Live-Räume (`relay`). Moderatoren dürfen sperren/entsperren, umbenennen und Runs
markieren; nur Admins dürfen Gilden auflösen, Runs und Spielerkonten löschen und Admins verwalten. Jede Änderung
landet im Protokoll. Die genauen Schemas stehen in `packages/contracts`.

„Mein Konto“ (jede Admin-Rolle, nur für sich selbst; Schemas `AdminChangePasswordRequest`,
`AdminChangeEmailRequest` in `packages/contracts/src/admin.ts`):

| Route | Antwort und Fehler |
| --- | --- |
| `POST /admin/me/password` `{ currentPassword, newPassword }` | `{ revokedSessions }`: neues Passwort (mind. 12 Zeichen), **alle anderen Sitzungen** des Kontos beendet, die aufrufende bleibt (gleiches Token, gleiches `expiresAt`); Protokoll `admin.password_change` (ohne Passwort, nur Anzahl beendeter Sitzungen) |
| `POST /admin/me/email` `{ email, currentPassword }` | `AdminSelf` mit der neuen Adresse (normalisiert wie `AdminEmail`); **ohne Bestätigungsmail** (kein Mailversand eingerichtet), Sitzungen bleiben; Protokoll `admin.email_change` mit `from`/`to` |

Fehler beider Routen: `400 invalid_current_password` (aktuelles Passwort falsch, ohne weitere
Details), `400 password_unchanged` bzw. `400 email_unchanged`, `409 email_taken` (erst nach richtigem
Passwort geprüft), `400 validation_error`, `429 rate_limited`: 10 Anfragen je IP und Minute für beide
Routen zusammen und 5 falsche aktuelle Passwörter je Konto in 15 Minuten (beides TESTWERT).
Umgesetzt direkt auf den Better-Auth-Tabellen mit denselben Hash-Funktionen statt über
`auth.api.changePassword`/`changeEmail`: Better Auth beendet mit `revokeOtherSessions` auch die
aufrufende Sitzung (neues Token, neue Laufzeit), sein E-Mail-Wechsel braucht Mailversand, und das
Protokoll läge nicht in derselben Transaktion.

Admin-API v2 (P18, P-023/P-024; Schemas in `packages/contracts/src/admin.ts`):

| Route | Rolle | Antwort / Fehler |
| --- | --- | --- |
| `GET /admin/stats` | Moderator | `AdminStats`, zusätzlich `newPlayers7d`, `activePlayers7d`, `runs24h`, `runs7d`, `runsTotal`, `runsByMode {solo, quick, guild}`, `activeGuilds7d` |
| `GET /admin/stats/daily?days=30` | Moderator | `AdminDailyStats`: `series[] {date, newPlayers, runs, activePlayers}`, `totals`, `roomReached[] {min, max, runs}`, `averageRoomReached`, `averageDurationSeconds`, `medianDurationSeconds`; `days` 1–90 |
| `GET /admin/relay/rooms` | Moderator | `AdminRelayRoomList` (`rooms[]` mit `code`, `mode`, `guildId`, `guildTag`, `guildName` (D-147, null bei Schnellen Spielen), `started`, `playerCount`, `maxPlayers`, `players[] {peerId, playerId, name, platform, host, inRoomSeconds}`, `ageSeconds`, `expiresAt`, `runsStarted`, `bytesInPerSecond`, `bytesOutPerSecond`); `501 relay_not_configured`, `502 relay_unavailable` |
| `POST /admin/relay/rooms/:code/close` `{ reason }` | Moderator | `{ code, playerIds, started }`; die Spieler bekommen `room_closed` (`closed_by_admin`); Protokoll `relay.room_close`; `404 room_not_found` |
| `POST /admin/relay/rooms/:code/kick` `{ playerId, reason }` | Moderator | `{ code, playerId, peerId, roomClosed }`; Protokoll `relay.kick` (Ziel Spieler); `404 player_not_in_room` |
| `POST /admin/players/:id/bans` | Moderator | wie bisher plus `relay`: `disconnected` \| `not_connected` \| `unavailable` \| `not_configured` |
| `GET /admin/players/:id` | Moderator | wie bisher (Sperr-Historie, letzte 20 Runs) plus `runsTotal`, `noteCount`; seit D-147 zusätzlich `guilds[] {id, name, tag, role}` und `guildTags[]` (`guild`/`guildTag` = älteste Gilde; `GET /admin/players` liefert `guildTags` ebenso) |
| `GET` / `POST /admin/players/:id/notes` `{ text }` | Moderator | `{ items: AdminPlayerNote[] }` bzw. 201 `AdminPlayerNote`; Protokoll `player.note_add` |
| `DELETE /admin/players/:id/notes/:noteId` | Admin oder Verfasser | 204; `403 forbidden`, `404 note_not_found`; Protokoll `player.note_delete` |
| `POST /admin/guilds/:id/transfer` `{ playerId, reason }` | Moderator | `{ id, founderId, previousFounderId }`; `404 not_a_member`, `409 already_founder`, `409 guild_disbanded`; Protokoll `guild.transfer` |
| `GET /admin/guilds?status=active\|disbanded\|all` | Moderator | `status` gewinnt über `includeDisbanded` |
| `GET /admin/audit?from=&to=&actionPrefix=&targetType=` | Moderator | `from`/`to` als Tag (`2026-10-15`, UTC, inklusive) oder Zeitpunkt; `actionPrefix` z. B. `relay.` |

## Konto-Profil (P-034, D-152)

Ein Konto hat **einen** Charakter: Anzeigename und Aussehen. Spielstände sind nur „Welten“ und geben dem
Konto keinen Namen mehr. Schemas `PlayerAppearance`, `PlayerCharacter` (`common.ts`) und
`UpdateProfileRequest` (`player.ts`).

- **Anlegen:** `POST /auth/device`, `/auth/dev`, `/auth/steam`, `/auth/google-play` nehmen optional
  `name` und `appearance`; beides gilt nur beim Anlegen eines Kontos. Ohne Namen heißt ein neues
  Geräte-Konto `Spieler-1234` (Zufallsziffern, nie aus der Geräte-ID). Bestehende Konten bleiben
  unverändert.
- **Ändern:** `PATCH /me { name?, appearance? }` → `PlayerSelf` (mit `appearance`). `appearance: null`
  setzt auf die Standardfigur zurück. Der gleiche Name noch einmal zählt nicht.
- **Grenze:** 3 eigene Namenswechsel je 24 Stunden (`MAX_NAME_CHANGES`, `NAME_CHANGE_WINDOW_HOURS`,
  TESTWERT), gezählt in `player_name_changes`; darüber `429 name_change_limited` mit `retryAfter`
  (Sekunden, auch als `Retry-After`), dann wird nichts von der Anfrage übernommen. Admins und
  Moderatoren benennen über `PATCH /admin/players/:id {name}` ohne Grenze um (Protokoll
  `player.rename`, Verlauf mit `byAdmin`).
- **Anzeige:** `appearance` steht in `PlayerSelf`, `GuildDetail.members[]` und (nur lesen)
  `AdminPlayerDetail`, dort zusätzlich `nameHistory` (neueste zuerst, höchstens 20). Der Relay-Status
  bleibt ohne Aussehen.
- **Aufbewahrung:** Namenswechsel 90 Tage (`NAME_HISTORY_RETENTION_DAYS`, TESTWERT), gelöscht vom
  Aufräumjob (`services/housekeeping.ts`) und mit dem Konto; beim Zusammenführen zweier Konten bleiben
  Name und Aussehen des bleibenden Kontos, der Verlauf wandert mit.
- **Offen:** Ein Filter für anstößige Namen fehlt noch (Store-Pflicht); bis dahin benennen Moderatoren
  im Admin-Panel um.

## Bug-Meldungen (P-033)

Das Feedback-Werkzeug im Spiel (F9) lädt Screenshot, Markierungen, Notiz und Kategorien hoch; Admins
und Moderatoren werten sie im Admin-Panel aus. Schemas und Grenzen in
`packages/contracts/src/bug-report.ts`. Seit 17.10.2026 hat das Werkzeug zwei Reiter, „Fehler melden“
und „Idee einreichen“: Das Feld `kind` (`bug` | `idea`) ist optional, ohne Feld gilt `bug` (ältere
Spielstände). Neue Builds schicken keine Kategorien mehr; `categories` bleibt für alte Builds erlaubt.

| Route | Rolle | Antwort / Fehler |
| --- | --- | --- |
| `POST /bug-reports` `CreateBugReportRequest` | Spieler (auch Gast) | `201 {id}`; `400 validation_error`, `400 invalid_json`, `400 invalid_image` (kein Base64, kein WebP/JPEG/PNG), `413 payload_too_large` (Body > 2,25 MiB oder Bild > 1,5 MiB), `401`, `403 banned`, `429 rate_limited` (`Retry-After`) |
| `GET /admin/bug-reports?status=&kind=&platform=&category=&playerId=&cursor=&limit=50` | Moderator | `AdminBugReportList`: `items[]` ohne Bild (`kind`, `notePreview`, `markCount`, `strokeCount`, `location` aus `context.location`), `nextCursor` (null = letzte Seite), `total`, `counts` je Status (ohne den Status-Filter), `kindCounts` je Art (ohne den `kind`-Filter) |
| `GET /admin/bug-reports/:id` | Moderator | `AdminBugReportDetail`: alles außer den Bild-Bytes, dazu `imageMime`, `imageBytes`, `imageUrl`, `expiresAt`; `404 bug_report_not_found` |
| `GET /admin/bug-reports/:id/image` | Moderator | Bild-Bytes mit gespeichertem `Content-Type`, `Cache-Control: private, max-age=300` |
| `PATCH /admin/bug-reports/:id` `{ status }` | Moderator | `AdminBugReportDetail`; `new` \| `seen` \| `done` \| `wont_fix`; Protokoll `bug_report.status` (`from`/`to`) |
| `DELETE /admin/bug-reports/:id` | Admin | 204; Protokoll `bug_report.delete` (ohne Notiz und Bild) |

- **Bild:** reines Base64 (kein `data:`-Präfix); der Typ kommt nur aus den Magic Bytes (PNG-Signatur,
  JPEG `FF D8 FF`, `RIFF….WEBP`). Gespeichert als `bytea` in `bug_reports.image`.
- **Body-Grenze** 2,25 MiB gilt nur für diese Route (`hono/body-limit`); alle anderen Routen bleiben
  unverändert.
- **Aufbewahrung:** `BUG_REPORT_RETENTION_DAYS` (90, TESTWERT); `services/housekeeping.ts` löscht
  beim Start der API und dann alle 24 Stunden. Mit dem Konto werden die Meldungen gelöscht
  (Fremdschlüssel mit Kaskade), beim Zusammenführen zweier Konten wandern sie mit (D-122).
- `GET /admin/stats` meldet `newBugReports` (Status `new`), die Lösch-Vorschau der Website
  `bugReportCount`.

## Anmeldung, Konten, Versionen (P14–P16)

- **Gast je Gerät** (`POST /auth/device`, `{ deviceId, name?, appearance? }`, P-028, P-034): ohne Schlüssel; `deviceId` ist eine
  zufällige UUID v4, die das Spiel einmal pro Installation erzeugt (32–128 Zeichen, nur `A-Z a-z 0-9 -`).
  Dieselbe `device`-Identität wie `/auth/dev`, Antwort wie dort. Später per Verknüpfungscode mit
  Steam/Google Play verbinden. Fehler: `400 validation_error`, `403 guest_auth_disabled`
  (`GUEST_AUTH_ENABLED=false`), `403 banned`, `429 rate_limited` (`GUEST_LOGINS_PER_MINUTE` je IP,
  `GUEST_ACCOUNTS_PER_HOUR` neue Konten je IP). `GET /public/config` meldet `guestAuth`.
- **Steam** (`POST /auth/steam`, `{ ticket, name? }`): Das Spiel schickt das Hex-Ticket von
  `GetAuthTicketForWebApi(STEAM_TICKET_IDENTITY)`, die API prüft es mit dem Publisher-Schlüssel bei
  `ISteamUserAuth/AuthenticateUserTicket`. Fehler: `401 invalid_steam_ticket`, `403 steam_banned`
  (`publisherbanned`/`vacbanned`), `502 steam_unavailable`, `403 banned` (Soulwick-Sperre).
- **Google Play** (`POST /auth/google-play`, `{ serverAuthCode, name? }`): Code bei
  `oauth2.googleapis.com/token` eintauschen, Spieler-ID von `games/v1/players/me`; nie eine ID vom
  Gerät. Fehler: `401 invalid_google_play_code`, `502 google_play_unavailable`.
- **Game Center** (`POST /auth/game-center`): Vertrag steht (`GameCenterAuthRequest`), Route antwortet
  bis iOS `501 not_implemented`. Ohne Konfiguration antworten Steam und Google `501 provider_not_configured`.
- **Verknüpfen** (D-121/D-122): Gerät A `POST /me/link-code` → 6 Zeichen, 10 min (TESTWERT, nur als
  HMAC gespeichert, ein Code je Konto). Gerät B (mit eigenem Konto angemeldet) `POST /me/link { code }`.
  Leeres Konto (keine Gilde, keine Runs) geht still im anderen auf; haben beide Fortschritt, kommt
  `409 account_has_progress` mit `remaining`/`removed`, bis das Spiel mit `confirmMerge: true`
  wiederholt. Dann bleibt das ältere Konto (Name, Gilden; die Mitgliedschaften des anderen wandern
  samt Rolle mit, solange es bei höchstens 5 Gilden bleibt, in einer gemeinsamen Gilde gilt die höhere
  Rolle, den Rest verlässt das andere Konto mit Gründer-Übergabe nach P-102; P-031),
  Identitäten, Runs, Sperr-Historie wandern mit, das andere Konto wird gelöscht. Gesperrt →
  `409 merge_blocked_banned`. Antwort: neuer Token für das bleibende Konto; Tokens des gelöschten
  Kontos sind ungültig, dessen Geräte landen bei der nächsten Anmeldung beim bleibenden Konto.
- **Entkoppeln**: `DELETE /me/identities/:provider` entfernt alle Identitäten dieses Providers, nie
  die letzte (`409 last_identity`).
- **Kontolöschung** (P-026, vollautomatisch, KONZEPT_ONLINE.md §3.7):
  - Spiel: `POST /me/deletion-code` → `201 {code, expiresAt}`; 8 Zeichen (ohne 0/O, 1/I/L), 15 min,
    einmal verwendbar (TESTWERT), nur als HMAC in `deletion_codes`; ein neuer Code ersetzt den alten.
    Gesperrte Spieler bekommen `403 banned` (P-108).
  - Website: `POST /account-deletion/verify {playerName, code}` → `200 {token, expiresAt, account:
    {playerName, guild: {name, tag} | null, runCount}}`. Jeder Fehler `400 invalid_deletion_code`
    (kein Hinweis, ob der Name existiert); `429 rate_limited` nach `DELETION_REQUESTS_PER_HOUR`
    je IP; 5 falsche Codes je Spielername verbrennen dessen Code.
  - Website: `POST /account-deletion/confirm {token}` → `200 {deleted: true, deletedAt}`; löscht wie
    `DELETE /me` (auch gesperrte Konten, im Protokoll markiert). `400 deletion_token_invalid` bei
    abgelaufenem (10 min), benutztem oder durch einen neuen Code ersetztem Token.
  - Jede Löschung (Website `web_code`, `DELETE /me` `in_game`, `DELETE /admin/players/:id` `admin`)
    schreibt `account_deletions` (Zeit, Kanal, `was_banned`, HMAC der Spieler-ID; kein Name) und
    die Logzeile `account_deleted` (nur Kanal, `wasBanned`). Admins lesen sie mit
    `GET /admin/account-deletions?from&to&channel&playerId&limit&offset` →
    `{items: [{id, deletedAt, channel, wasBanned}], total, counts: {web_code, in_game, admin}}`
    (Moderator und Admin). `DELETE /admin/players/:id { note? }` (nur Admin, Protokoll
    `player.delete` mit Name und Notiz, Antwort mit `wasBanned`). `GET /admin/stats` hat
    `deletions7d`; `openDeletionRequests` ist veraltet und immer 0.
- **Versionen**: `GET /health` und `GET /public/config` melden `minGameVersion` und
  `protocolVersion`, `/public/config` zusätzlich `relayUrl` (je Umgebung).
