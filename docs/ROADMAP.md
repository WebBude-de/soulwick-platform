# ROADMAP – Soulwick Platform

> **Stand:** 17.10.2026 · **Fokus jetzt: Website zuerst**, davor die Umstellung auf Bun/Turbo/Prisma (P7, P8). Die Pakete P1–P6 entsprechen MP7, MP7b, MP8 und MP9 aus `soulwick/docs/ROADMAP_MULTIPLAYER.md`, hier nur der **Plattform-Teil**. Spielseitige Punkte (GDScript-Client, Gildengebäude, Anzeige im Spiel) bleiben in der Spiel-Roadmap. Das Zielbild Crossplay (Steam, Google Play, App Store) steht in `soulwick/docs/ROADMAP_CROSSPLAY.md` (D-108); die Architektur (Host + eigener Relay, Steam → Android → iOS, Publisher WebBude) ist mit **D-119** entschieden (14.10.2026). Konzept für die Online-Pakete P13–P17: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md).
> **Abhaken** nur mit Nachweis (Prüfbefehle grün, Datum). Jedes Paket ist für **einen Agenten** geschnitten und nennt seine Dateien; der Koordinator hakt nach Prüfung ab.

## Überblick und Reihenfolge

| Paket | Inhalt | Status | Wartet auf |
| --- | --- | --- | --- |
| P1 | Grundgerüst (API, Web, Admin, Compose) | fertig (13.10.2026) | – |
| **P7** | Bun-Workspaces + Turborepo statt pnpm, API auf Bun, `bun test`, Docker-Images auf Bun | **Code fertig (14.10.2026)**; offen: Umbenennung `infra/` → `local-dev/` (Freigabe durch das Projektmitglied), Web-Image nach P9, Doku-Texte | – |
| **P8** | Prisma in `packages/db`, Port der Routen, `player_identities`, Rechtstext-Tabellen, Tests gegen Docker-Postgres | **Code fertig (14.10.2026)**; offen: `db:reset` der lokalen Dev-Datenbank durch das Projektmitglied | P7 |
| **P9** | Website v2: DE/EN, Landingpage mit Sprites, Spielseite, Plattformen, Rechtsseiten aus der API | geplant | P7 (Bun-Befehle); Rechtsseiten brauchen P10 |
| **P10 / P10b** | Rechtstexte über eRecht24 (API-Teil / Admin-Panel) | **fertig (14.10.2026), am 15.10.2026 auf das DapItUp-Muster umgebaut (P-025):** nur Abruf mit Speicher-Cache, kein Push, kein Admin-Tab; wartet auf beide eRecht24-Schlüssel | P8 |
| **P11** | Konten für Crossplay: Datenbank-Grundlage jetzt, Routen später | **Grundlage fertig (14.10.2026)**, Routen nach CP0/CP1 | P8; Routen erst nach CP0/CP1 |
| **P12** | Website-Grafiken (Lieferung durch das Projektmitglied) | geplant | – (jederzeit) |
| **P13** | Relay-Dienst `apps/relay` (Raumcodes, Paket-Weiterleitung) | **fertig (14.10.2026)**, 145/145 Tests | Vertrag `packages/contracts/src/lobby.ts` (zuerst); P8 (Token-Format) |
| **P14** | Plattform-Anmeldung: Steam echt, Google Play; Game Center später | **API fertig (14.10.2026)**, Tests mit Fake-`fetch`; offen: echter Steam-Login mit eigener AppID (MP10), Google-Login aus „Interner Test“ (CP7), Game Center (iOS) | Vertrag `identity.ts`; eigene Steam-AppID (MP10), Play-Console-Konto (CP7) |
| **P15** | Konto verknüpfen und Kontolöschung | Verknüpfen fertig (14.10.2026); **Löschung vollautomatisch (P-026): API fertig (15.10.2026)**, Admin „Löschprotokoll“ fertig (15.10.2026); offen: Website zweistufig (web-dev), `SUPPORT_EMAIL` in Dokploy, Konto-Panel im Spiel (CP1) | P14 (Vertrag `identity.ts`); Regel zum Zusammenführen entschieden (D-122) |
| **P16** | Versionen und Umgebungen (`minGameVersion`, `protocolVersion`, Umgebungen, URLs im Build) | **API fertig (14.10.2026)** (`/health`, `/public/config`); offen: Dokploy-Doku (Integrator), Haken im Spiel (CP7) | – (vor P13-Abnahme) |
| **P17** | Relay auf Dokploy (`play.`-Domain, WebSocket über Traefik, Monitoring) | geplant | P13, P2 |
| **P18** | Admin-API v2: Statistik, Live-Räume (Relay), Moderation | **API, Relay und Admin-Panel fertig (15.10.2026)**, 218/218 Tests; offen: Variablen in Dokploy (Integrator) | P13, P15 |
| **P19** | Better Auth für Admins und Spieler, Relay-JWT über JWKS (P-027) | **API, Relay und Admin-Panel fertig (15.10.2026)**, 246/246 Tests; offen: Variablen in Dokploy | P8, P13, P14 |
| **P20** | Gast-Anmeldung je Gerät `POST /auth/device` (P-028) | **API fertig (15.10.2026)**; offen: Spiel-Client (Gast statt Dev-Schlüssel), Variablen in Dokploy prüfen, Hinweis „Konto verknüpfen“ im Spiel (CP1) | P14, P15 (Verknüpfungscode) |
| **P21** | Bug-Meldungen aus dem Spiel mit Screenshot, Auswertung im Admin-Panel (P-033) | **API fertig (16.10.2026)**; offen: Admin-Seite (admin-dev), Absenden im Spiel (F9), Zusatz Datenschutzerklärung, Variablen in Dokploy | P19 (Sessions), P20 (Gastkonten) |
| **P22** | Konto-Profil: ein Charakter (Name + Aussehen) je Konto (P-034, D-152) | **API fertig (16.10.2026)**; offen: Profil-Editor im Spiel, Anzeige im Admin-Panel (admin-dev), Namensfilter | P20 |
| **P23** | Kosmetik im Profil (Plattform-Teil von WK2): Kosmetik von Spielfigur und Wick im Vertrag `PlayerAppearance`, Übertragung über `PATCH /me` | geplant | **WK0** (Spiel-Repo: Aussehen und Rolle von Wick, D-175 OFFEN), P22 |
| **P24** | Dorf-Schnappschuss (Plattform-Teil von WK6): Dorf mit Deko auf dem Server, Gilde und Freunde schauen es an (nur ansehen) | geplant | WK0, WK5 (Dorf-Deko im Spiel), P4 (Gilden, MP8) |
| P2 | Online gehen (Dokploy) | geplant | P7, P8 (Images auf Bun, Prisma-Migrationen) |
| P3 | Website fertig (alte Fassung) | offene Punkte gehen in P9, P10, P12 auf | – |
| P4 | Gilden im Spiel nutzbar | geplant | **MP0** (Spiel-Repo), **CP0** (Fragen 3/4 entschieden, D-119), P13 (Gilden-Räume) |
| P5 | Ranglisten live | geplant | **MP0**, **CP0** (Frage 7), P14/P15 (Konten) |
| P6 | Steam-Anmeldung | in **P14** aufgegangen | MP10 (eigene AppID) |

**Parallel möglich:** P9 (web-dev) läuft parallel zu P8/P10/P11 (api-dev), sobald P7 die Befehle umgestellt hat; P12 ist unabhängig. P13 (Relay) berührt nach dem Vertrag nur `apps/relay` und darf parallel zu allem laufen; P14 und P15 teilen `identity.ts`, `routes/auth.ts`/`routes/me.ts` und laufen nacheinander. P8, P10 und P11 teilen `packages/db/prisma/schema.prisma` und laufen deshalb **nacheinander** (oder ein Agent macht P8 mit den Tabellen aus P10/P11 in einem Zug, so wie unten beschrieben).

## P1 – Grundgerüst (MP7, MP7b) ✔

- [x] pnpm-Monorepo, `@soulwick/contracts`, `@soulwick/api`, `@soulwick/web`, `@soulwick/admin`, `infra/` (13.10.2026).
- [x] API: Anmeldung (dev, Steam-Stub), Gilden, Gilden-Fortschritt mit Versionsprüfung, Run-Berichte mit Plausibilitätsprüfung, Ranglisten, Admin-Routen mit Rollen und Protokoll (13.10.2026).
- [x] Tests mit PGlite: 27/27 (13.10.2026).
- [x] Website: Startseite, Ranglisten, Gildenseiten, Datenschutz/Impressum (Platzhalter) (13.10.2026).
- [x] Admin-Panel: Anmeldung, Übersicht, Spieler, Gilden, Runs, Protokoll, Admins (13.10.2026).
- [x] Docker-Compose lokal, alle Images bauen und laufen (13.10.2026).

## P2 – Online gehen (MP7)

Wartet auf P7 und P8 (die Images und der Migrationslauf ändern sich mit Bun und Prisma).

- [ ] Annahmen aus [DECISIONS.md](DECISIONS.md) (P-Einträge mit Status VORGESCHLAGEN) im Team bestätigen.
- [ ] Domain festlegen; in Dokploy `soulwick-postgres`, `soulwick-api`, `soulwick-web`, `soulwick-admin` (und mit P17 `soulwick-relay`) anlegen ([infra/DOKPLOY.md](../infra/DOKPLOY.md); Doku fertig 14.10.2026, noch nicht auf dem Server erprobt).
- [ ] Geheimnisse nur in Dokploy (`BETTER_AUTH_SECRET` statt `TOKEN_SECRET`/`ADMIN_TOKEN_SECRET` seit P-027, `DEV_AUTH_KEY`, `RELAY_INTERNAL_KEY`, Datenbank, später `ERECHT24_API_KEY` und `ERECHT24_PLUGIN_KEY`).
- [ ] Tägliches Datenbank-Backup einrichten und eine Wiederherstellung einmal testen.
- [ ] Admin-Panel zusätzlich schützen (Basic Auth oder IP-Liste).
- [ ] Ersten Admin anlegen, Moderatoren einladen.
- [ ] Fehlerprotokoll (Logs in Dokploy) und `GET /health` überwachen.

## P3 – Website fertig (MP7b, alte Fassung)

Die offenen Punkte sind in **P9** (Seiten, zwei Sprachen), **P10** (Rechtstexte) und **P12** (Grafiken) neu geschnitten; hier bleibt nur der Nachweis für den Linter.

- [ ] ~~Logo, Keyart, Biom-Bilder, Screenshots einbauen~~ → P12 (Lieferung) und P9 (Einbau).
- [ ] ~~Datenschutzerklärung und Impressum~~ → P10 (eRecht24 über die API), P9 (Anzeige).
- [ ] Optional: Download-Seite für Test-Builds (MP4), Discord-Link → P9, wenn es Builds gibt.
- [x] Linter einrichten: Biome 2.5 mit Ultracite-Presets (`core`, `react`, `next`) als `pnpm check` / `pnpm fix` (`pnpm lint` = Alias), Husky-Pre-Commit-Hook; `pnpm check` meldet 0 Fehler (13.10.2026). Ab P7 heißen die Befehle `bun run check` / `bun run fix`.

## P4 – Gilden im Spiel nutzbar (MP8, zusammen mit dem Spiel-Repo)

**Wartet ausdrücklich auf** die Multiplayer-Entscheidungen **MP0** (`soulwick/docs/ROADMAP_MULTIPLAYER.md`) und die Crossplay-Entscheidungen **CP0** (`soulwick/docs/ROADMAP_CROSSPLAY.md`): Lobby/Relay ist mit D-119 entschieden, das Konto-Modell mit D-121 und D-122 (ein Soulwick-Konto mit verknüpften Plattform-Identitäten, Regel zum Zusammenführen). Gilden-Runs laufen über den Relay im Modus `guild`; die Mitgliedschaft prüft der Relay über die API (**P13**, interner Endpunkt).

- [x] *(15.10.2026; Migration `multi_guilds`, `db:verify` grün; `bun test` 306/306, live gegen eigene API 8797 und eigenen Relay 8798 mit Seed-Spielern geprüft)* **Gilden vollständig online (D-147, P-031):** bis zu 5 Gilden je Spieler (TESTWERT), `GET /me/guilds`, Gilden-Routen mit Gilden-ID (`/guilds/:id`, `…/leave`, `…/members/:playerId`, `…/invite-code`, `…/progress`), Rechte Gründer/Offizier/Mitglied, alte `/guilds/me*`-Routen entfernt (`API_VERSION` 1.1.0); Relay lässt in Gilden-Räume nur Mitglieder (`guildIds` im internen Status-Endpunkt, frische Nachfrage bei „kein Mitglied“); Konto verknüpfen und löschen mit mehreren Gilden; Dev-Seed mit zweiter Gilde „Aschenrunde“, Lumen in beiden.
- [ ] Gilden-Wappen (8 Stück) und Wappen-Auswahl in Verträgen und API.
- [ ] Gilden-Schmiede: Stufen, Kosten, Wirkung als Vertrag (gleiche Werte wie im Spiel); Kauf aus der Gildenkasse über die API mit Versionsprüfung.
- [x] *(15.10.2026; P-032, Tests in `apps/api/test/guilds.test.ts`)* Auszahlung nach Gilden-Run in die Gildenkasse (50-/100-%-Regel), gemeldet durch den Host (`POST /runs` mit `endReason` und `remainingGold`), geprüft gegen den Run-Bericht (Melder muss Mitglied sein, markierte Runs zahlen nichts); Schutz gegen doppelte Meldung über `reportId` (Migration `run_report_id`; gleiche ID → 200 mit gespeichertem Ergebnis, auch bei gleichzeitigen Wiederholungen nur eine Auszahlung).
- [ ] Spiel-Repo: GDScript-Client (`HTTPRequest`) nach `packages/contracts`; Spiel bleibt offline spielbar.

**Fertig, wenn:** Drei Personen eine Gilde gründen bzw. beitreten, einen Gilden-Run spielen und die Gildenkasse danach für alle gleich ist.

## P5 – Ranglisten live (MP9)

**Wartet auf MP0 und CP0** (Ranglisten je Plattform oder gemeinsam, Konto-Modell für die eigene Position). Plattform-Anmeldung und verknüpfte Konten kommen aus **P14** und **P15**.

- [ ] Ranglisten-Anzeige im Spiel (Top 50 + eigene Position) über die bestehende API.
- [ ] Saisonwechsel automatisch (Kalendermonat, UTC); Archiv vergangener Saisons auf der Website.
- [ ] Moderation: Melden-Knopf auf der Website, gemeldete Runs im Admin-Panel.
- [ ] Testphasen-Ranglisten zum Steam-Start zurücksetzen (Admin-Aktion mit Protokoll).

## P6 – Steam (MP10)

**Aufgegangen in P14** (Plattform-Anmeldung, Steam echt). Wartet auf die eigene AppID (MP10). Steam ist nur Zusatz für Anmeldung und Einladungen, kein Transport (P-017). Das Zusammenführen von Konten wird nicht mehr hier, sondern in P11/P15/CP1 als Soulwick-Konto mit mehreren Identitäten gelöst.

- [ ] `/auth/steam` mit eigener AppID testen; Dev-Anmeldung danach abschalten. → P14
- [ ] ~~Steam-ID als Hauptkennung; Geräte-ID-Konten zusammenführen~~ → P11 (`player_identities`), Verknüpfung in CP1.

## P7 – Bun/Turbo-Umstellung (Code fertig 14.10.2026, Rest offen)

**Ziel:** Gleiches Werkzeug wie DapItUp (P-009): Bun-Workspaces mit hoisted Linker, Turborepo für `dev`/`build`/`typecheck`, API läuft auf Bun, `bun test`, Husky mit `bunx biome`, Docker-Images auf `oven/bun` (API) bzw. `node:24-slim` + Next standalone (Web, Admin). Kein pnpm mehr.

**Agent:** Koordinator/Integrator (Root-Dateien sind Hotspots). **Dateien:** Root `package.json`, `bunfig.toml` (neu), `turbo.json` (neu), `bun.lock` (neu), `.husky/pre-commit`, `.nvmrc`/`.gitignore`/`.dockerignore`, `apps/*/package.json`, `apps/*/Dockerfile`, `apps/api/src/index.ts` (Server-Start auf Bun), `local-dev/docker-compose.yml` (nur lokale Dienste), `tsconfig.base.json`, optional `packages/config` (gemeinsame TS-Konfiguration), `README.md`, `AGENTS.md`; entfernt: `pnpm-lock.yaml`, `pnpm-workspace.yaml`.

- [x] *(14.10.2026)* Root-`package.json`: `packageManager: bun@1.3.14`, `workspaces: ["apps/*", "packages/*"]`, Skripte wie in [TECHSTACK.md](TECHSTACK.md) §4 (`bun dev`, `bun run dev:api|dev:web|dev:admin`, `check`, `fix`, `typecheck`, `test`, `build`, `services:up|down`, `db:*` als Platzhalter bis P8).
- [x] *(14.10.2026; `packages/config` mit `tsconfig/base.json` und `bun.json` wie DapItUp)* `bunfig.toml` mit `linker = "hoisted"`, `turbo.json` mit den Tasks `dev` (persistent, kein Cache), `build`, `typecheck`, `generate` (für P8 vorbereitet).
- [x] *(14.10.2026)* API auf Bun: Hono mit `Bun.serve`, Start **direkt aus der Quelle** (`bun src/index.ts`, kein esbuild-Bundle mehr, P-002 damit erledigt), `Bun.password` (argon2id) statt `@node-rs/argon2`, Client-IP über `@hono/bun`.
- [x] *(14.10.2026: 27/27 unter `bun test` mit PGlite, 14,8 s)* Tests mit `bun test` als Runner (statt Vitest); die Datenbank-Anbindung wechselt in P8 auf Docker-Postgres.
- [x] *(14.10.2026)* Husky: `pre-commit` nutzt `bunx biome`; `prepare` über `bun install`. `pre-push` kommt mit P8.
- [ ] *(API 390 MB und Admin 412 MB gebaut und gestartet, `/health` ok, 14.10.2026; Web-Image baut erst wieder, wenn P9 typisiert ist)* Dockerfiles: API auf `oven/bun:1.3`, Web und Admin mit Bun für `install`, Next-Build und Standalone-Runtime auf `node:24-slim`. Die drei Images bauen einzeln (`docker build -f apps/<app>/Dockerfile .`) und starten; `local-dev/docker-compose.yml` enthält nur die lokalen Dienste Postgres (MinIO am 15.10.2026 entfernt) (wie DapItUp), die Apps werden auf Dokploy getrennt aus ihren Dockerfiles gebaut.
- [ ] *(Doku fertig 14.10.2026, zusätzlich `packages/contracts/README.md`, `docs/TECHSTACK.md`, `docs/ARCHITECTURE.md`; Dokploy-Anleitung liegt bis zur Umbenennung in `infra/DOKPLOY.md`; vom Koordinator abzunehmen)* `README.md`, `AGENTS.md`, `apps/*/README.md`, `.claude/agents/*.md`, `docs/DOKPLOY.md` auf die Bun-Befehle und das getrennte Deployment umschreiben (Integrator). `.nvmrc` bleibt: Next läuft lokal und im Image weiter auf Node.
- [ ] *(optional, macht nur das Projektmitglied; bis dahin bleibt `infra/` und die Doku vermerkt, dass es nur lokale Dienste enthält, 15.10.2026)* `infra/` → `local-dev/` umbenennen und `infra/DOKPLOY.md` nach `docs/DOKPLOY.md` verschieben (die Berechtigungsprüfung hat das dem Agenten verweigert; Compose enthält nur noch Postgres). Danach alle Verweise anpassen und `bun run services:up` einmal starten.

**Fertig, wenn:** `bun install`, `bun run check`, `bun run typecheck`, `bun test`, `bun run build` grün sind, alle drei Images bauen und das API-Image gegen den lokalen Postgres antwortet (`GET /health`), und weder `pnpm-lock.yaml` noch `pnpm-workspace.yaml` mehr im Repo liegen.

## P8 – Prisma-Grundgerüst (`packages/db`)

**Ziel:** Prisma 7.10 ersetzt Drizzle (P-010). Neues Workspace `@soulwick/db`, frische Migrations-Baseline, bestehende Routen unverändert portiert (Vertrag bleibt), neue Tabellen `player_identities`, `legal_documents`, `erecht24_push_clients` gleich mit angelegt. Tests laufen mit `bun test` gegen den lokalen Docker-Postgres mit einer Wegwerf-Datenbank je Lauf (P-011); PGlite entfällt. Noch nichts ist deployt, deshalb wird die Drizzle-Historie **ersetzt**, nicht migriert.

**Agent:** `api-dev`. **Dateien:** `packages/db/**` (neu: `package.json`, `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/`, `src/index.ts`, `scripts/db-status.ts`, `scripts/verify-migrations.ts`), `apps/api/src/db/*` (ersetzen), `apps/api/src/services/*`, `apps/api/src/routes/*`, `apps/api/src/middleware/auth.ts`, `apps/api/src/scripts/*`, `apps/api/test/**`, `apps/api/package.json`, `apps/api/Dockerfile`, `.husky/pre-push` (neu), Root-`package.json` (nur die `db:*`-Skripte), `local-dev/docker-compose.yml` (falls eine Test-Datenbank-Variable nötig ist); entfernt: `apps/api/drizzle/`, `apps/api/drizzle.config.ts`. **Nicht:** `packages/contracts` (außer die bereits vorhandene `legal.ts`).

- [x] *(14.10.2026)* `packages/db`: Generator `prisma-client`, `@prisma/adapter-pg`, `prisma.config.ts` (liest `DATABASE_URL`, Migrationspfad `prisma/migrations`), Export des Clients; nur `apps/api` importiert `@soulwick/db`.
- [x] *(14.10.2026)* Schema: alle Tabellen aus [ARCHITECTURE.md](ARCHITECTURE.md) §3 inklusive `player_identities` (ersetzt `players.steam_id`/`players.device_id`), `legal_documents`, `erecht24_push_clients`. Eine Baseline-Migration.
- [x] *(14.10.2026; `db:verify` grün 3,2 s; `db:reset` verweigert Prisma 7 aus Agenten-Sitzungen, das Projektmitglied führt es einmal aus)* Skripte: `db:migrate --name <name>`, `db:deploy`, `db:reset`, `db:generate`, `db:studio`, `db:status`, `db:verify` (baut alle Migrationen in einer Wegwerf-DB und vergleicht mit dem Schema); `db:verify` im Husky-`pre-push`, nur wenn Schema oder Migrationen geändert wurden.
- [x] *(14.10.2026)* Routen und Services ohne Vertragsänderung portieren; `/auth/dev` und `/auth/steam` lesen/schreiben `player_identities` (`device`, `steam`); Vertragsfelder `steamId`/`hasDeviceId` werden aus den Identitäten abgeleitet.
- [x] *(14.10.2026: `bun test` 61/61 inkl. 4 Identitäten-Tests, Wegwerf-DB je Lauf)* Tests: `bun test` legt je Lauf eine Datenbank `soulwick_test_<zufall>` auf dem Docker-Postgres an, spielt `prisma migrate deploy` ein und löscht sie am Ende; `Deps`-Injektion (`now`, `fetch`) bleibt.
- [x] *(14.10.2026)* Dev-Seed (`db:seed:dev`) und `admin:create` (am 15.10.2026 durch den Basis-Seed `db:seed` ersetzt, P19) auf Prisma portiert; API-Image startet mit `prisma migrate deploy`, dann API (ersetzt `MIGRATE_ON_START`/`MIGRATIONS_DIR`).

**Fertig, wenn:** `bun run db:reset` und `bun run db:verify` grün sind, `bun test` gegen den Docker-Postgres mindestens die bisherigen 27 Fälle plus Identitäten-Tests grün meldet, `bun run typecheck` und `bun run build` laufen, `git diff packages/contracts` leer ist (außer `legal.ts`) und `apps/api/drizzle/` nicht mehr existiert.

## P9 – Website v2 (DE/EN, Landingpage mit Sprites)

**Ziel:** Die öffentliche Website wird der aktuelle Fokus: verspielte Landingpage mit Spiel-Sprites und Animationen, eine Seite, die das Spiel erklärt, ein Plattform-Abschnitt (Steam, Google Play, App Store als „geplant“, Hinweis auf Crossplay), Ranglisten und Gildenseiten, Rechtsseiten aus der API. Deutsch **und** Englisch von Anfang an (P-012), alle Bilder als WebP (P-015).

**Agent:** `web-dev`. **Dateien:** `apps/web/**` (`src/app/…`, `src/i18n/*`, `src/proxy.ts` bzw. Middleware, `messages/de/*.json`, `messages/en/*.json`, `src/components/*`, `public/sprites/` erzeugt, `scripts/sync-sprites.ts`, `next.config.ts`, `package.json`, `README.md`). **Nicht:** `apps/web/public/brand/*` (Lieferung P12, README dort bleibt), API, Verträge.

- [x] *(14.10.2026: Build grün, Cookie/Browsersprache/alte Links per curl und Chrome geprüft)* `next-intl` **ohne Sprache im Pfad** (P-012, Projektmitglied 14.10.2026): englische Pfade `/`, `/leaderboards`, `/guilds/[tag]`, `/imprint`, `/privacy`; Sprache aus Cookie `NEXT_LOCALE` (Umschalter, zusätzlich `localStorage`), sonst Browsersprache, sonst Englisch; alte `/de/...`- und `/en/...`-Links leiten um; Metadaten und Open Graph (`og_image.webp`).
- [ ] Texte ausschließlich in `messages/{de,en}/*.json` (Namensräume `common`, `home`, `game`, `leaderboards`, `guilds`, `legal`); keine Texte im Code.
- [ ] Landingpage: Hero mit `logo.webp` und `keyart.webp` (Fallback `hero_player_lantern.webp`, dann das 1×-Logo aus dem Spiel hochskaliert); Abschnitte Spiel in einem Satz, vier Biome (`biome_*.webp`), Dorf, Koop und Gilden („geplant“), Plattformen (Chips `platform_pc`, `platform_mobile`, `platform_crossplay`, keine Store-Badges ohne echte Links), Ranglisten-Teaser; animierte Sprites (Spieler, Schleim, Seelenflamme) als CSS-`steps()`-Animation über die Sprite-Streifen, `image-rendering: pixelated`, `prefers-reduced-motion` beachtet.
- [x] ~~Spielseite `/de/spiel`~~ **entfällt** (Projektmitglied 14.10.2026: die Website ist ein Teaser, keine Anleitung; die Anker der Landingpage reichen, das Spiel erklärt sich im Spiel). Keine Steuerungs-, Waffen- oder Upgrade-Tabellen auf der Website.
- [ ] Sprites: Skript `scripts/sync-sprites.ts` kopiert eine feste Liste aus `../soulwick/art/` nach `public/sprites/` als **verlustfreies WebP** (`sharp` nur als devDependency); die erzeugten Dateien werden versioniert, damit der Build ohne Spiel-Repo läuft.
- [x] *(14.10.2026: Platzhalter und HTML-Darstellung gegen eine Test-API geprüft; echte Texte nach P10 Phase B)* Rechtsseiten lesen `GET /legal/imprint` bzw. `/legal/privacy-policy` und zeigen das HTML der Sprache; bei `status: missing` oder fehlender Sprache ein deutlicher Platzhalter („Text folgt“) statt eines Fehlers; Revalidate wie `apiGet`.
- [x] *(14.10.2026: im Handoff-Stil, gegen eine Test-API geprüft; Nachprüfung mit echtem Seed nach P8)* Ranglisten und Gildenseiten (`/leaderboards`, `/guilds/[tag]`); API nicht erreichbar → Hinweisbox (wie bisher). `not-found` je Sprache.
- [ ] Palette und Schrift aus `docs/design/TOKENS.md` (Pixelify Sans für Titel, DM Sans für Fließtext; Herkunft `soulwick/docs/HANDOUT.md`); Erzählung und Seitenaufbau nach `docs/design/web/KONZEPT_WEB.md` (maßgeblich seit 17.10.2026, D-173 bis D-179); `docs/design/web/HANDOFF_WEB.md` und die Mockups in `docs/design/web/` sind abgelöst und nur noch Inspiration für Layout und Pixel-Komponenten; Spiel-Screens in `soulwick/docs/design/` nur als Inspiration.

**Fertig, wenn:** `bun run build` ohne laufende API durchläuft, alle Seiten in beiden Sprachen rendern, der Sprachwechsel auf jeder Seite die passende Gegenseite öffnet, die Sprites animieren, die Rechtsseiten ohne eRecht24-Schlüssel den Platzhalter zeigen und `bun run check`/`typecheck` grün sind.

## P10 – Rechtstexte über eRecht24 (API-Teil)

**Ziel:** Impressum und Datenschutzerklärung kommen aus dem eRecht24 Projekt-Manager (Rechtstexte-API v2) und werden von der API als `GET /legal/:type` ausgeliefert (P-013). Seit **P-025** (15.10.2026) genau wie im Referenz-Repo DapItUp: nur Abruf mit Cache im Speicher, keine Tabelle, keine Push-Clients, keine Admin-Funktionen. Vertrag: `packages/contracts/src/legal.ts` (Antwort unverändert). Ohne beide eRecht24-Schlüssel liefert alles `status: missing`, ohne Fehler.

**Agent:** `api-dev`. **Dateien:** `apps/api/src/lib/erecht24/` (Client, Datum, HTML, `sanitize.ts`), `apps/api/src/services/legal.ts`, `apps/api/src/routes/legal.ts`, `apps/api/src/config.ts`, `apps/api/.env.example`, `apps/api/test/legal.test.ts`, `apps/api/test/erecht24-client.test.ts`, `apps/api/test/erecht24-sanitize.test.ts`.

- [x] *(14.10.2026, auf Abruf reduziert 15.10.2026: Client nur noch `GET /<typ>`, Datumsparser Europe/Berlin, HTML-Warnungen zu Textzeilen, Fehlercodes `erecht24_*`)* Client: `GET /imprint`, `GET /privacyPolicy`, `GET /privacyPolicySocialMedia` → `html_de`, `html_en`, `created`, `modified`, `warnings`, immer mit den Headern `eRecht24-api-key` **und** `eRecht24-plugin-key`. Basis `ERECHT24_API_URL` (Standard `https://api.e-recht24.de/v2`), Zeitlimit 10 s, Fehler als `ApiError`, Aufruf über `Deps.fetch`.
- [x] *(15.10.2026, P-025: `services/legal.ts`)* Cache **im Speicher** je Typ wie DapItUp: Erfolg 24 h, Fehler 60 s, laufende Anfrage wird geteilt. eRecht24-404 oder nach der Bereinigung leeres HTML → `missing` (60 s). Schlägt ein Nachladen fehl, bleibt der letzte gute Text (wie vorher mit der Tabelle); ohne guten Text `502 erecht24_*`. Log `legal_refresh_failed`.
- [x] *(15.10.2026, P-025: `lib/erecht24/sanitize.ts`, aus DapItUp übernommen, Bun-`HTMLRewriter`, keine neue Abhängigkeit)* HTML-Bereinigung nach Allowlist, führendes `<h1>` entfällt, Links nur http(s)/mailto/tel.
- [x] *(15.10.2026, P-025)* ~~Push `/legal/erecht24/push`, Admin `/admin/legal/status|refresh|push-client`, Audit `legal.*`, Tabellen `legal_documents`/`erecht24_push_clients`~~ entfernt; Migration `20261015081948_drop_legal_cache`. Alte Protokollzeilen `legal.*` bleiben lesbar.
- [x] *(15.10.2026: `config.ts`, `apps/api/.env.example`)* Konfiguration: `ERECHT24_API_KEY` und `ERECHT24_PLUGIN_KEY` (beide nötig), `ERECHT24_API_URL`; `ERECHT24_AUTHOR_MAIL` und `PUBLIC_API_URL` entfallen.
- [x] *(15.10.2026: `legal.test.ts` 11 Tests, `erecht24-client.test.ts` 19, `erecht24-sanitize.test.ts` 18; `bun test` gesamt 219/219)* Tests mit injiziertem `fetch` und Uhr: fehlende Schlüssel, beide Header, Bereinigung, 24-h-Cache, 60-s-Fehler-Cache, geteilte Anfrage, alter Text bei Fehler, 404 → `missing`, entfernte Routen → 404.

**Fertig, wenn:** die Tests grün sind, `curl /legal/imprint` ohne Schlüssel `status: missing` liefert und mit beiden Schlüsseln des Projektmitglieds (sobald da) deutsches und englisches HTML erscheint (spätestens nach 24 h bzw. nach einem Neustart der API).

## P10b – Rechtstexte im Admin-Panel

**Entfällt mit P-025 (15.10.2026):** keine Admin-Funktionen mehr für Rechtstexte. Die Seite „Rechtstexte“ (`apps/admin/src/app/(panel)/rechtstexte/*`) entfernt `admin-dev` in einem parallelen Auftrag; alte Protokolleinträge `legal.*` zeigt das Protokoll weiter an.

- [x] ~~*(14.10.2026)* Seite „Rechtstexte“ mit Status, „Jetzt aktualisieren“ und „Push-Client registrieren“~~ (ersetzt durch P-025)
- [x] *(15.10.2026; Admin-Typecheck und -Build grün)* Seite und Navigationseintrag im Admin-Panel entfernt (`admin-dev`).

## P11 – Konten für Crossplay (Grundlage jetzt, Routen später)

**Ziel:** Vorbereitung für das Zielbild Steam + Google Play + App Store (D-108, `soulwick/docs/ROADMAP_CROSSPLAY.md`): Ein Spieler kann **mehrere Identitäten** haben. Jetzt nur die Datenbank-Grundlage (P-014); Verknüpfungs-Routen, Verknüpfungscodes und Google-/Apple-Prüfung erst nach den Entscheidungen CP0/CP1. Der HTTP-Vertrag für `/auth/dev` und `/auth/steam` bleibt unverändert.

**Agent:** `api-dev` (kann mit P8 zusammengelegt werden). **Dateien:** `packages/db/prisma/schema.prisma` + Migration, `apps/api/src/services/identities.ts` (neu), `apps/api/src/routes/auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/admin/players.ts`, `apps/api/src/scripts/seed-dev.ts`, Tests. **Nicht:** `packages/contracts` (keine neuen Routen).

- [x] *(14.10.2026)* Enum `identity_provider` (`steam`, `device`, `google_play`, `game_center`); Tabelle `player_identities` (`id`, `player_id` → `players` mit `on delete cascade`, `provider`, `provider_user_id`, `created_at`, `last_used_at`; eindeutig über `provider` + `provider_user_id`; mehrere je Spieler erlaubt).
- [x] *(14.10.2026)* `players` verliert `steam_id` und `device_id`; `/auth/dev` findet oder erzeugt den Spieler über die Identität `device`, `/auth/steam` über `steam`; Antwortfelder `steamId` (Spieler, Admin) und `hasDeviceId` (Admin) werden aus den Identitäten abgeleitet, bis der Vertrag ein `identities`-Feld **ergänzt** (nicht in diesem Paket).
- [x] *(14.10.2026)* `DELETE /me` löscht die Identitäten mit (Kaskade); Dev-Seed legt je Spieler eine `device`-Identität an.
- [ ] Keine Verknüpfungs-Routen, kein Verknüpfungscode, keine Google-Play-/Game-Center-Prüfung in diesem Paket (kommen in P14 und P15, CP1).

**Fertig, wenn:** die Migration läuft, beide Anmelde-Routen über Identitäten funktionieren, ein Test einen Spieler mit zwei Identitäten anlegt und über beide findet, der GDScript-Client nichts ändern muss und alle Tests grün sind.

## P12 – Website-Grafiken (Lieferung durch das Projektmitglied)

**Wer:** das Projektmitglied mit Claude Design; Briefing `soulwick/docs/design/sprites/SPRITES_V5.md` §8 (ersetzt `soulwick/docs/design/sprites/SPRITES_V3.md` §6, jetzt WebP); neue Website-Grafiken (Wick, Dorf bei Tag, Teilen-Bilder): [design/web/BRIEFING_WEB.md](design/web/BRIEFING_WEB.md). **Ablage:** `apps/web/public/brand/` nach der dortigen README; Dateinamen exakt übernehmen, die Website lädt nach Namen und zeigt bis dahin Platzhalter.

- [ ] `logo.webp` (512×128), `logo_square.webp` (256×256), `keyart.webp` (1920×1080), `og_image.webp` (1200×630), `biome_crypt.webp`, `biome_slime_grotto.webp`, `biome_shadow_realm.webp`, `biome_ember_forge.webp` (je 640×360).
- [ ] `hero_player_lantern.webp` (256×256) als Hero-Fallback ohne Keyart; `platform_pc.webp`, `platform_mobile.webp`, `platform_crossplay.webp` (je 32×32) für die Plattform-Chips (keine Markenlogos).
- [ ] Nach der Lieferung prüft `web-dev` Größen, Transparenz und das Open-Graph-Bild (Vorschau in einem Sharing-Debugger); Favicon aus `logo_square.webp`.

**Fertig, wenn:** alle Dateien liegen, die Website keinen Platzhalter mehr in Kopfzeile, Hero und Biom-Karten zeigt.

## P13 – Relay `apps/relay`

**Ziel:** Ein eigener Bun-Dienst mit WebSocket, der Räume mit Raumcode verwaltet und Spielpakete zwischen Host und Clients weiterleitet, ohne sie zu verstehen (D-119, P-016). Protokoll, Raum-Lebenszyklus und Schutz: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §2. Gegenstück im Spiel: `online/relay_peer.gd`, `online/lobby_client.gd` (`soulwick/docs/ROADMAP_CROSSPLAY.md` CP3).

**Agent:** zuerst `api-dev` für den Vertrag, dann ein neuer Agent `relay-dev` (Definition in `.claude/agents/` durch den Integrator, Vorschlag) oder `api-dev`. **Dateien:** `packages/contracts/src/lobby.ts` (neu, nur `api-dev`), `packages/contracts/src/index.ts` (Export), `apps/relay/**` (neu: `package.json`, `src/index.ts`, `src/config.ts`, `src/protocol.ts`, `src/rooms.ts`, `src/auth.ts`, `src/limits.ts`, `src/metrics.ts`, `test/*.test.ts`, `Dockerfile`, `.env.example`, `README.md`), `apps/api/src/routes/internal/relay.ts` (neu, interner Status-Endpunkt, nur `api-dev`), `apps/api/src/config.ts` (`RELAY_INTERNAL_KEY`). **Nicht:** Root-`package.json`, `turbo.json` (Integrator, falls der Workspace dort nicht automatisch erfasst wird).

- [x] *(14.10.2026; zusätzlich `room_state`, `ping`/`pong`, Close-Codes, Fehler `hello_required`, `invalid_message`, `not_in_room`, `not_host`, `peer_not_found`, `invalid_target`, `kicked`, `api_unavailable`, Grund `left`)* Vertrag `lobby.ts`: Steuer-Nachrichten (`hello`, `welcome`, `create`, `created`, `join`, `joined`, `peer_joined`, `peer_left`, `start`, `started`, `kick`, `leave`, `room_closed`, `error`) als zod-Schemas, Fehlercodes, Konstanten des Binärrahmens `{from, to, channel, mode, data}`, Testvektoren (Bytefolgen) für TypeScript und GDScript.
- [x] *(14.10.2026)* Verbindungsaufbau: `hello` mit Spieler-JWT innerhalb von 5 s (TESTWERT), Prüfung mit `TOKEN_SECRET` (wie die API; seit P19/P-027 gegen die JWKS der API), gleiche `protocolVersion` Pflicht (P16), Herzschlag 15 s / Zeitlimit 30 s (TESTWERTE).
- [x] *(14.10.2026; Beitritt nur mit gleicher `gameVersion` wie der Host, gekickte Spieler können nicht zurück)* Räume im Speicher: Code aus 6 Zeichen ohne verwechselbare Zeichen, Modus `quick` | `guild`, Host = Peer 1, Clients ≥ 2, höchstens 4 Spieler, Ablauf nach 10 min ohne Start (TESTWERT), Raum schließt, wenn der Host geht, kein Beitritt nach `start` (D-085), ein Raum je Spieler.
- [x] *(14.10.2026; Standard `CLIENT_ROUTING=host_only`: Clients senden nur an den Host, `any` per Variable, Entscheidung mit MP2)* Weiterleitung: `from` setzt der Relay, `to` = Peer, 0 = alle, negativ = alle außer; Absender und Ziel müssen im Raum sein; Inhalt wird nicht gelesen.
- [x] *(14.10.2026; Rahmengröße TESTWERT 64 KiB statt 16 KiB, per `MAX_FRAME_BYTES`; je IP: neue Verbindungen pro Minute; je Verbindung: Nachrichten/s und Bytes/s; Rückstau: unzuverlässige Pakete verwerfen, sonst Empfänger trennen)* Schutz: Rate-Limit je IP und Spieler, Rahmengröße (TESTWERT 16 KiB), Bytes/s und Nachrichten/s je Verbindung; `TRUST_PROXY` wie die API.
- [x] *(14.10.2026; Antwort zusätzlich `playerId`, `name`, `guildId`; Cache 30 s TESTWERT; API nicht erreichbar: Schnelles Spiel geht, Gildenraum `api_unavailable`)* Interner Endpunkt `GET /internal/relay/players/:playerId/status?guildId=…` mit `x-relay-key` → `{ banned, guildMember }`; der Relay fragt ihn bei `guild`-Räumen und für Sperren (kurzer Cache).
- [x] *(14.10.2026; `/metrics` nur mit `x-relay-key`)* Logs als JSON ohne Paketinhalte; `GET /health` (Status, `protocolVersion`, Räume) und `GET /metrics` (intern: Räume, Spieler, Bytes/s).
- [x] *(14.10.2026; auch `RELAY_SIM_LATENCY_MS`/`RELAY_SIM_LOSS`, in `production` ignoriert; Verlust nur für unzuverlässige Pakete; `bun run dev:relay` geprüft)* Startoptionen `--sim-latency` und `--sim-loss` nur für lokale Tests; `bun dev` startet den Relay mit (Port 8790, Vorschlag).
- [x] *(14.10.2026: Relay 61/61 inkl. Ende-zu-Ende mit Host + 3 Clients über echte WebSockets und Gildenprüfung über eine Fake-API; API-Endpunkt 6 Tests; gesamt `bun test` 145/145)* Tests mit `bun test`: Protokoll gegen die Testvektoren, Raum-Lebenszyklus (erstellen, beitreten, voll, Ablauf, Host geht, Client geht, Start sperrt Beitritt), JWT ungültig/abgelaufen, Versionskonflikt, Limits, Gilden-Prüfung mit gemocktem `fetch`.
- [x] *(14.10.2026; `oven/bun:1.3.14`, 326 MB, läuft als `bun`, `/health` ok, Healthcheck „healthy“, `docker stop` beendet sauber mit 0)* Docker-Image auf `oven/bun:1.3`, baut einzeln (`docker build -f apps/relay/Dockerfile .`) und startet ohne root.

**Fertig, wenn:** `bun test` für den Relay grün ist, zwei WebSocket-Testclients über einen Raum Rahmen austauschen, das Image baut und `/health` antwortet, `bun run check`, `typecheck` und `build` grün sind und der Vertrag in `lobby.ts` vor dem Code stand.

## P14 – Plattform-Anmeldung (Steam echt, Google Play; Game Center später)

**Ziel:** Echte Anmeldung je Store, alle mit demselben Spieler-JWT und über `player_identities` (P-014). Abläufe: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §3.2–§3.4. Übernimmt den Rest von P6.

**Agent:** `api-dev`. **Dateien:** `packages/contracts/src/identity.ts` (neu, zuerst), `packages/contracts/src/index.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/services/steam.ts`, `apps/api/src/services/google-play.ts` (neu), `apps/api/src/services/game-center.ts` (später), `apps/api/src/services/identities.ts`, `apps/api/src/config.ts`, `apps/api/.env.example`, `apps/api/test/**`.

- [x] *(14.10.2026; Game Center antwortet bis iOS `501 not_implemented`, unkonfigurierte Provider `501 provider_not_configured` statt bisher `not_implemented` bei Steam)* Vertrag `identity.ts`: `POST /auth/google-play` (`serverAuthCode`), später `POST /auth/game-center` (`publicKeyUrl`, `signature`, `salt`, `timestamp`, `playerId`, `bundleId`); Antwort wie `/auth/dev` und `/auth/steam` (Felder nur ergänzen, nichts umbenennen).
- [x] *(14.10.2026, mit Fake-`fetch` geprüft; `publisherbanned`/`vacbanned` → `403 steam_banned`, Zeitlimit `EXTERNAL_AUTH_TIMEOUT_MS`; Standard `STEAM_TICKET_IDENTITY` jetzt `soulwick` wie im Konzept; echter Test mit eigener AppID offen, MP10)* Steam echt: `AuthenticateUserTicket` mit `STEAM_WEB_API_KEY`, `STEAM_APP_ID`, `STEAM_TICKET_IDENTITY`; `steamid` (bei Familienfreigabe `ownersteamid` beachten) → Identität `steam`; Fehler ohne Details nach außen.
- [x] *(14.10.2026, mit Fake-`fetch` geprüft; Fehler `401 invalid_google_play_code`, `502 google_play_unavailable`; echter Test aus „Interner Test“ offen, CP7)* Google Play: Server-Auth-Code bei `oauth2.googleapis.com/token` eintauschen (`GOOGLE_PLAY_CLIENT_ID`, `GOOGLE_PLAY_CLIENT_SECRET`, Namen Vorschlag), dann `games/v1/players/me` → `playerId` → Identität `google_play`. **Nie** eine ID vom Gerät übernehmen.
- [ ] Game Center erst mit iOS (später): Zertifikat nur von Apple-Domains, Signaturprüfung, Zeitfenster für `timestamp`.
- [x] *(14.10.2026: `apps/api/test/platform-auth.test.ts`, 14 Tests; `bun test` gesamt 178/178)* Tests mit injiziertem `fetch` (Erfolg, ungültiges Ticket/Code, Google nicht erreichbar, gesperrter Spieler, bestehende Identität → gleicher Spieler).

**Fertig, wenn:** die Tests grün sind und mit der eigenen AppID (MP10) ein Steam-Login sowie aus der Play-Spur „Interner Test“ ein Google-Login in `development` einen Spieler anlegen bzw. wiederfinden.

## P15 – Konto verknüpfen und Kontolöschung

**Ziel:** Ein Soulwick-Konto über mehrere Geräte und Stores per Verknüpfungscode (wie Among Us) und eine Web-Seite für den Löschantrag, die Google Play verlangt. Abläufe: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §3.5–§3.7. Regel für das Zusammenführen: D-122 (Konzept §3.6).

**Agenten nacheinander:** `api-dev` (Vertrag, API, Datenbank), danach parallel `web-dev` (Seite) und `admin-dev` (Liste der Anträge). **Dateien:** `api-dev`: `packages/contracts/src/identity.ts`, `packages/db/prisma/schema.prisma` + Migration (Tabellen für Verknüpfungscodes und Löschanträge, Vorschlag), `apps/api/src/routes/me.ts`, `apps/api/src/routes/account-deletion.ts` (neu), `apps/api/src/routes/admin/deletion-requests.ts` (neu), `apps/api/src/services/identities.ts`, `apps/api/test/**`. `web-dev`: `apps/web/src/app/delete-account/**`, `apps/web/messages/{de,en}/*.json`. `admin-dev`: `apps/admin/src/app/(panel)/loeschantraege/**`, Navigation.

- [x] *(14.10.2026; Code nur als HMAC in `link_codes`, ein Code je Konto; `DELETE` entfernt alle Identitäten des Providers; `/me/link` mit eigenem Rate-Limit `LINK_ATTEMPTS_PER_MINUTE`)* `POST /me/link-code` (6 Zeichen, 10 min gültig, TESTWERT), `POST /me/link`, `GET /me/identities`, `DELETE /me/identities/:provider` (letzte Identität nicht entkoppelbar).
- [x] *(14.10.2026; eine Transaktion; leeres Konto geht in das andere auf, egal ob Codebesitzer oder Einlöser; Gründer: gildenloses bleibendes Konto übernimmt Mitgliedschaft samt Rolle, sonst Übergabe nach P-102; Sperre → `409 merge_blocked_banned`; Log-Zeile `account_linked`)* Leeres Zielkonto → Identität wandert still, leeres Konto wird gelöscht; Konto mit Fortschritt → `409 account_has_progress`, nie stilles Zusammenführen; Zusammenführung nach Bestätigung im Spiel gemäß D-122.
- [x] *(14.10.2026, **ersetzt durch P-026 am 15.10.2026**, siehe unten; `GET /me/deletion-code` (8 Zeichen, HMAC der Spieler-ID), Antrag ohne Code wird unbestätigt gespeichert, falscher Code `400 invalid_deletion_code`; `GET /admin/deletion-requests` (Moderator), `POST /admin/deletion-requests/:id/resolve` (Admin, Protokoll `deletion_request.resolve`))* Löschcode für den Web-Antrag (im Spiel angezeigt) und `POST /account-deletion-requests` (öffentlich, Rate-Limit, Spielername + Löschcode); Admin-Routen zum Ansehen und Erledigen mit `audit_log`.
- [x] *(14.10.2026; alle Fälle mit und ohne JavaScript geprüft)* Website `/delete-account` (DE/EN): erklärt die Löschung in der App und nimmt den Antrag an; Link für das Play-Formular „Datensicherheit“.
- [x] *(14.10.2026, **ersetzt durch P-026**: Seite wird zum „Löschprotokoll“)* Admin-Panel „Löschanträge“: Liste, Status, „erledigt“ mit Protokoll. Konto löschen aus dem Panel folgt (`DELETE /admin/players/:id`).
- [x] *(14.10.2026: `apps/api/test/account-link.test.ts`, 14 Tests inkl. Gildenfälle, gemeinsamer Run, Sperre, Rate-Limit)* Tests: Code erzeugen/einlösen/abgelaufen, Konflikt, Entkoppeln, Antrag mit falschem Code.

**Nachtrag 15.10.2026 – Kontolöschung vollautomatisch (P-026, Auftrag des Projektmitglieds; ersetzt P-022):** Kein Admin entscheidet mehr. Ablauf: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §3.7. **Dateien:** `api-dev`: `packages/contracts/src/{identity,admin,common}.ts`, Schema + Migration `automatic_account_deletion`, `apps/api/src/{services/account-deletion.ts,routes/account-deletion.ts,routes/me.ts,routes/admin/account-deletions.ts,routes/admin/players.ts,routes/public.ts,lib/tokens.ts,lib/time-range.ts,config.ts}`, Dev-Seed, Tests. `web-dev`: `apps/web/src/app/delete-account/**`, `apps/web/src/components/deletion/**`, `apps/web/src/lib/deletion-form.ts`, `apps/web/messages/{de,en}/deletion.json`. `admin-dev`: `apps/admin/src/app/(panel)/loeschantraege/**` → „Löschprotokoll“, Übersicht, Navigation, `actions.ts`, `lib/{api,format}.ts`.

- [x] *(15.10.2026; HMAC in `deletion_codes`, ein Code je Spieler, neuer Code ersetzt die Zeile samt ID; `apps/api/test/account-deletion.test.ts`)* `POST /me/deletion-code` → `{code, expiresAt}` (8 Zeichen, 15 min, einmal, TESTWERT); `GET /me/deletion-code` entfernt.
- [x] *(15.10.2026; gleiche Antwort für alle Fehler, 5/h je IP plus 5 Fehlversuche je Spielername, Token mit abgeleitetem Schlüssel)* `POST /account-deletion/verify {playerName, code}` → Bestätigungstoken (10 min) + Anzeige (Name, Gilde, Runs); `POST /account-deletion/confirm {token}` löscht wie `DELETE /me`, auch gesperrte Konten (markiert); `POST /account-deletion-requests` entfernt.
- [x] *(15.10.2026; Migration `20261015083016_automatic_account_deletion`, `db:verify` grün)* Löschprotokoll `account_deletions` (Kanal `web_code`/`in_game`/`admin`, „war gesperrt“, HMAC der Spieler-ID, kein Name) für alle drei Wege; Tabelle `account_deletion_requests` entfernt.
- [x] *(15.10.2026)* Admin: `GET /admin/account-deletions?from&to&channel&playerId` (Moderator, nur lesen, Zähler je Kanal) statt `/admin/deletion-requests`; `AdminStats.deletions7d`, `openDeletionRequests` bleibt (immer 0); `DELETE /admin/players/:id` schreibt Kanal `admin`.
- [x] *(15.10.2026; `apps/api/test/versions.test.ts`)* `SUPPORT_EMAIL` → `GET /public/config` `supportEmail` (null = nicht anzeigen).
- [x] *(15.10.2026; `bun test` 224/224, Dev-Seed zweimal gegen eine Wegwerf-Datenbank)* Tests (Code erzeugen/ersetzen/abgelaufen/verbraucht, gleiche Antwort bei falschem Namen/Code, Rate-Limit, Löschung samt Gilde/Gründer/Runs, Token abgelaufen/doppelt/ersetzt, Protokoll ohne Namen, Admin-Rollen); Dev-Seed mit 4 Protokolleinträgen statt Löschanträgen.
- [ ] Website `/delete-account` zweistufig: Name + Code → Anzeige → „Endgültig löschen“; Support-Adresse aus `/public/config` (web-dev).
- [x] *(15.10.2026; Admin-Typecheck, -Build und Biome grün; gegen API, Relay und Wegwerf-Datenbank mit Dev-Seed im Browser durchgespielt: Kontolöschung durch Admin erscheint als 5. Eintrag „Durch Admin“, Spieler-ID-Suche „gelöscht“ bzw. „besteht noch“, Kanal-Filter, `/loeschantraege` leitet um)* Admin-Panel: „Löschanträge“ → „Löschprotokoll“ (Liste, Filter Zeitraum/Kanal, Suche nach Spieler-ID, Zähler), Übersicht mit `deletions7d`, Protokoll-Filter ohne `deletion_request.` (admin-dev).
- [ ] `SUPPORT_EMAIL` je Umgebung in Dokploy setzen (Integrator).
- [ ] Spiel (CP1): Konto-Panel mit „Löschcode für die Website“ und „Konto löschen“ (Haken in KONZEPT_ONLINE.md §3.7).

**Fertig, wenn:** ein Spieler auf zwei Geräten per Code ein Konto nutzt, die Lösch-Seite ohne Anmeldung in beiden Sprachen ein Konto mit Code aus dem Spiel löscht, das Löschprotokoll im Admin-Panel erscheint und alle Prüfbefehle grün sind.

## P16 – Versionen und Umgebungen

**Ziel:** Crossplay über Stores mit zeitversetzten Updates sicher machen und die Umgebungen `development`/`production` für API, Relay und Spiel-Builds sauber trennen ([KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §3.8 und §4, P-018).

**Agent:** `api-dev` (Vertrag und API), Integrator (Dokploy-Doku). **Dateien:** `packages/contracts/src/common.ts` (Health-Antwort), `apps/api/src/app.ts` (bestehende Health-Route), `apps/api/src/config.ts`, `apps/api/.env.example`, `apps/relay/src/config.ts` (falls P13 schon steht, sonst Haken), `infra/DOKPLOY.md`.

- [x] *(14.10.2026; Felder optional im Vertrag, zusätzlich `GET /public/config` mit `apiVersion`, `minGameVersion`, `protocolVersion`, `relayUrl` aus `RELAY_PUBLIC_URL`; `apps/api/test/versions.test.ts`, 5 Tests)* `GET /health` liefert zusätzlich `minGameVersion` und `protocolVersion` (Felder ergänzt, `API_VERSION` bleibt); Werte aus `MIN_GAME_VERSION` und `PROTOCOL_VERSION` je Umgebung.
- [x] *(14.10.2026, steht seit P13: `apps/relay/src/config.ts` liest `PROTOCOL_VERSION` (Standard aus `@soulwick/contracts`), `hello.test.ts` prüft `version_mismatch`)* Relay liest dieselbe `PROTOCOL_VERSION` und lässt nur gleiche Versionen in einen Raum.
- [ ] *(Doku fertig 14.10.2026: [infra/DOKPLOY.md](../infra/DOKPLOY.md) §4; offen bis zur Einrichtung auf dem Server)* Dokploy-Doku: Variablen je Umgebung für API und Relay (seit P-027 `BETTER_AUTH_SECRET` nur bei der API, `RELAY_INTERNAL_KEY` gemeinsam, `MIN_GAME_VERSION`, `PROTOCOL_VERSION`, `RELAY_PUBLIC_URL`), Domains nach P-018.
- [ ] Haken für das Spiel-Repo (CP7): API- und Relay-URL je Umgebung beim Export, `protocolVersion` als Konstante im Spiel; Update-Sperre im Hauptmenü bei zu alter Version.

**Fertig, wenn:** `/health` in beiden Umgebungen die neuen Felder liefert, ein Test die Felder prüft, die Dokploy-Doku die Variablen nennt und der Haken für das Spiel beschrieben ist.

## P17 – Relay auf Dokploy

**Ziel:** Der Relay läuft in beiden Umgebungen unter eigener Domain mit WebSocket über Traefik und wird überwacht ([KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §4, P-018).

**Agent:** Integrator (Betrieb, Doku). **Dateien:** `infra/DOKPLOY.md`, ggf. `apps/relay/Dockerfile` (nur Feinschliff, nach P13).

Doku für alle Punkte fertig (14.10.2026) in [infra/DOKPLOY.md](../infra/DOKPLOY.md) (§0 Checkliste, §2 DNS, §4 Variablen, §6 Relay, §11 Monitoring; Checkliste für die Dev-Instanz und Test-Build für Freunde ergänzt 15.10.2026); abgehakt wird erst nach der Einrichtung auf dem Server.

- [ ] *(Doku fertig 14.10.2026)* DNS: `play.playsoulwick.com` und `play-dev.playsoulwick.com` (Vorschlag P-018) auf den VPS, mit Cloudflare-Proxy und flachen Dev-Namen (P-029).
- [ ] *(Doku fertig 14.10.2026)* Dokploy: Application `soulwick-relay` je Umgebung aus `apps/relay/Dockerfile`, Build-Kontext `.`, Port 8790, **genau eine Replica**, Healthcheck `/health`, Watch Paths `apps/relay/**`, `packages/contracts/**`.
- [ ] *(Doku fertig 14.10.2026, Prüfanleitung mit `wscat` und Traefik-Zeitlimits)* WebSocket über Traefik prüfen (Upgrade, lange Verbindungen, Zeitlimits), z. B. mit einem WebSocket-Kommandozeilen-Client gegen `wss://play-dev.playsoulwick.com/v1`.
- [ ] *(Doku fertig 14.10.2026, auf P-027 umgestellt 15.10.2026)* Variablen aus P16 setzen; `API_INTERNAL_URL` (interne Adresse der API, Pflicht: JWKS) und `RELAY_INTERNAL_KEY` gleich wie die API derselben Umgebung (`TOKEN_SECRET` entfällt).
- [ ] *(Doku fertig 14.10.2026)* Monitoring: Logs in Dokploy, `/health` überwachen, Metriken (Räume, Spieler, Bytes/s) und den Inklusivtraffic des VPS beobachten; Vorgehen bei Ausfall dokumentieren (das Spiel zeigt einen Status, Einzelspieler bleibt spielbar).

**Fertig, wenn:** zwei Spiel-Instanzen (oder zwei Testclients) über `wss://play-dev.playsoulwick.com` einen Raum teilen, der Healthcheck in Dokploy grün ist und die Doku die Einrichtung beschreibt.

## P18 – Admin-API v2: Statistik, Live-Räume, Moderation

**Ziel:** Das Admin-Panel bekommt Kennzahlen, sieht die laufenden Relay-Räume und kann moderieren (Notizen, Kicken, Räume schließen, Gildenleitung übertragen). Entscheidungen: P-023, P-024.
**Dateien:** `packages/contracts/src/admin.ts`, `lobby.ts`; `apps/api/src/routes/admin/{stats,relay,player-notes}.ts`, `services/{admin-stats,player-notes}.ts`, `lib/relay-client.ts`; `apps/relay/src/internal.ts`, `relay.ts`, `rooms.ts`; Migration `admin_player_notes`; Dev-Seed.

- [x] *(15.10.2026; `apps/api/test/admin-stats.test.ts`, 4 Tests)* `GET /admin/stats` additiv erweitert (`newPlayers7d`, `activePlayers7d`, `runs24h`, `runs7d`, `runsTotal`, `runsByMode`, `activeGuilds7d`); `GET /admin/stats/daily?days=1..90` mit Tagesreihe (UTC), Summen, Raum-Verteilung, Dauer-Mittel/Median; nur Zahlen.
- [x] *(15.10.2026; `apps/relay/test/internal.test.ts`, 9 Tests; `PROTOCOL_VERSION` bleibt 1, Nachtrag: Schließen sendet den ergänzten Grund `closed_by_admin`)* Relay: `GET /internal/rooms` (ohne Tokens), `POST /internal/rooms/:code/close`, `POST /internal/rooms/:code/kick`, `POST /internal/players/:id/ban`; Bytes/s je Raum, Status-Cache `forget`.
- [x] *(15.10.2026; `apps/api/test/admin-relay.test.ts`, 8 Tests mit injiziertem `fetch`)* API: `GET /admin/relay/rooms`, `POST /admin/relay/rooms/:code/close|kick` mit Grund und Protokoll; `501 relay_not_configured`, `502 relay_unavailable`; Sperre trennt den Spieler am Relay (best effort, Feld `relay` in der Antwort).
- [x] *(15.10.2026; Migration `20261015072323_admin_player_notes`, `db:verify` grün; `apps/api/test/admin-moderation.test.ts`, 7 Tests)* Moderations-Notizen (`player_notes`), Spieler-Details mit `runsTotal`/`noteCount`, `POST /admin/guilds/:id/transfer`, Gildenfilter `status`, Protokollfilter `from`/`to`/`actionPrefix`/`targetType`.
- [x] *(15.10.2026; zweimal hintereinander gegen eine Wegwerf-Datenbank geprüft)* Dev-Seed: 2 neue Spieler, 14 Runs über die letzten zwei Wochen, eine Moderations-Notiz.
- [x] *(15.10.2026; gegen echten Relay mit drei Räumen geprüft: Entfernen → `kicked`, Schließen → `closed_by_admin`, Sperre trennt am Relay (4003); Relay aus → Hinweis 502, ohne `RELAY_INTERNAL_URL` → Hinweis 501; Notizen als Admin und Moderator, Übergabe, Gilden- und Protokollfilter)* Admin-Panel: Übersicht mit Kennzahlen und Tagesreihe, Seite „Live-Räume“, Notizen, Übergabe, Filter (admin-dev).
- [ ] Dokploy: `RELAY_INTERNAL_URL` (interne Adresse des Relays) bei der API setzen, `RELAY_INTERNAL_KEY` bei API und Relay gleich (Integrator, `infra/DOKPLOY.md`).

## P19 – Better Auth für Admins und Spieler (P-027)

**Ziel:** Eine Anmeldung über Better Auth für die ganze API: Admins mit E-Mail/Passwort und Rollen, Spieler über ein eigenes Plugin mit Plattform-Identitäten; der Relay prüft kurzlebige Spieler-JWTs gegen die JWKS der API statt eines gemeinsamen Geheimnisses. Entscheidung: P-027 (Auftrag des Projektmitglieds 15.10.2026; Wünsche der MP-Sitzung soulwick-3a zum Spiel-Client eingehalten).
**Dateien:** `packages/db/prisma/schema.prisma` + Migration `better_auth`; `packages/contracts/src/{player,admin,lobby}.ts`; `apps/api/src/auth/{auth,player-plugin}.ts`, `middleware/auth.ts`, `routes/{auth,me}.ts`, `routes/admin/index.ts`, `services/{sessions,admin-users,passwords}.ts`, `lib/{secrets,tokens}.ts`, `config.ts`, Skripte `create-admin.ts` (seit 15.10.2026 `seed.ts`), `seed-dev.ts`; `apps/relay/src/{auth,config,relay,server}.ts`; Env-Dateien; Doku.

- [x] *(15.10.2026; `bun add better-auth` 1.7.9 in `apps/api`, `jose` 6.2 in `apps/relay`)* Better-Auth-Instanz mit Prisma-Adapter, uuid-IDs, Plugins `admin`, `bearer` (nur signierte Tokens), `jwt` (EdDSA, Rotation 30 Tage, Karenz 2 Tage, TESTWERT), eigenes Plugin `soulwickPlayerAuth`; Handler nicht gemountet, nur Hono-Routen.
- [x] *(15.10.2026; Migration `20261015091335_better_auth` mit Datenübernahme, gegen eine Wegwerf-Datenbank mit Beispiel-Admins geprüft; `db:verify` grün, 6 Migrationen, Dev-Seed läuft)* Tabellen `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_jwks`; `admin_users` mit gleichen IDs und argon2id-Hashes übertragen und entfernt; Fremdschlüssel von `audit_log`, `bans`, `player_notes` zeigen auf `auth_users`.
- [x] *(15.10.2026; `apps/api/test/better-auth.test.ts`, 11 Tests)* Admins: Login mit unveränderter Antwortform, Logout, alte Hashes, Deaktivieren beendet Sessions sofort, Rollen, Spieler-Token auf Admin-Routen → 401.
- [x] *(15.10.2026; `better-auth.test.ts`, `platform-auth.test.ts` + Google-Play-Sperre)* Spieler: `/auth/dev|steam|google-play` unverändert (Bann-Fehlercode mit `reason`/`expiresAt`), Session-Token 30 Tage auf allen Spieler-Routen, unsignierte/manipulierte Tokens → 401, `/me/link` neue Session, Löschen beendet die Session.
- [x] *(15.10.2026)* `GET /auth/token` (JWT, 15 min, Claims `sub`, `name`, `iat`, `exp`, `iss`, `aud`), `GET /auth/jwks`; Admins und Gesperrte bekommen keins.
- [x] *(15.10.2026; `apps/relay/test/{hello,jwks,config}.test.ts`, e2e gegen Fake-API mit JWKS; Relay 86/86)* Relay prüft `hello.token` gegen die JWKS (Cache, Rotation über unbekannte `kid`, Abkühlzeit, letzter Schlüsselsatz bei API-Ausfall), nur bei `hello`; `TOKEN_SECRET` entfällt, `API_INTERNAL_URL` Pflicht.
- [x] *(15.10.2026; alle Env-Dateien mit `loadConfig` geprüft)* `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` statt `TOKEN_SECRET`/`ADMIN_TOKEN_SECRET`; HMAC-Schlüssel der Codes aus `BETTER_AUTH_SECRET` abgeleitet; Env-Dateien, READMEs, `infra/DOKPLOY.md`, TECHSTACK, ARCHITECTURE, KONZEPT_ONLINE nachgezogen.
- [x] *(15.10.2026; im Browser geprüft: Cookie httpOnly/Strict, läuft genau 8 h, für JS unsichtbar; nach „Abmelden“ ist das alte Token bei der API 401; abgelaufenes Cookie und ungültiges Token → `/login?abgelaufen=1` mit Hinweis)* Admin-Panel: Token weiter im httpOnly-Cookie, Abmelden über `POST /admin/auth/logout`, Cookie-Laufzeit nach `expiresAt` (admin-dev).
- [x] *(15.10.2026; feature/multiplayer: `Session.ensure_relay_token()`, net_smoke und net_run_smoke grün gegen echten Stack)* Spiel: vor jedem `hello` `GET /auth/token` holen, `token` der Anmeldung nur noch als Bearer (GDScript-Client, MP-Sitzung).
- [x] *(15.10.2026, 3 Migrationen eingespielt, Seed ergänzt, Admin-Login geprüft)* Lokale Dev-Datenbank des Projektmitglieds: `bun run db:deploy` (die Migration übernimmt die Admins), danach `bun run db:seed:dev`.
- [x] *(15.10.2026; `apps/api/test/admin-account.test.ts`, 7 Tests: Erfolg, falsches aktuelles Passwort, zu kurzes und gleiches neues Passwort, E-Mail-Konflikt 409, andere Sitzungen beendet und aktuelle behalten, Audit ohne Passwort, Moderator für sich selbst, Rate-Limits je Konto und IP; Admin-Panel lokal gegen die API geprüft)* **Mein Konto:** `POST /admin/me/password` (aktuelles Passwort, neues nach `AdminPassword`, andere Sitzungen beendet) und `POST /admin/me/email` (aktuelles Passwort, `AdminEmail`, 409 `email_taken`, ohne Bestätigungsmail); Protokoll `admin.password_change` / `admin.email_change`; Seite `/konto` im Admin-Panel. Keine Migration.
- [x] *(15.10.2026; `apps/api/test/seed.test.ts`, 6 Tests: legt an, wenn die Adresse fehlt; vorhandenes Konto samt Passwort-Hash unverändert; ungültige Werte und lokaler Standard in production nur Warnung; nach E-Mail-Wechsel kein Neuanlegen; Skript ohne Variablen Exit 0)* **Basis-Seed** `bun run db:seed` (`apps/api/src/scripts/seed.ts`, wie DapItUp): Start-Admin aus `DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD`, nur wenn die Adresse fehlt, nie überschrieben; läuft im API-Image nach `migrate deploy` bei jedem Start. `admin:create` entfällt; der Dev-Seed lässt vorhandene Admin-Konten unverändert.
- [ ] Root-`README.md` (lokaler Ablauf nennt noch `TOKEN_SECRET`) nachziehen (Integrator).
- [ ] Dokploy: `DEFAULT_ADMIN_EMAIL` und `DEFAULT_ADMIN_PASSWORD` bei `soulwick-api` je Umgebung setzen, nach dem ersten Login das Passwort unter „Mein Konto“ ändern und `DEFAULT_ADMIN_PASSWORD` entfernen (Projektmitglied).
- [ ] Optional: Zwei-Faktor für Admins (`twoFactor()`-Plugin, Tabelle, Routen `/admin/auth/two-factor/*`, Oberfläche im Panel).

## P20 – Gast-Anmeldung je Gerät (P-028)

**Ziel:** Spieler ohne Steam/Google und Tester ohne Dev-Schlüssel spielen online mit einem Gastkonto je Gerät; später verknüpfen sie es per Verknüpfungscode. Entscheidung: P-028.
**Dateien:** `packages/contracts/src/{player,common}.ts`; `apps/api/src/routes/{auth,public}.ts`, `lib/rate-limit.ts`, `services/identities.ts`, `config.ts`; Test `apps/api/test/guest-auth.test.ts`; Env-Dateien, README, Doku.

- [x] *(15.10.2026)* Vertrag `DeviceAuthRequest { deviceId, name }` (`GuestDeviceId` 32–128 Zeichen, `A-Z a-z 0-9 -`), Antwort `AuthResponse`; `PublicConfig.guestAuth` (optional).
- [x] *(15.10.2026)* Route `POST /auth/device` über `signInPlayer` mit der `device`-Identität; Schalter `GUEST_AUTH_ENABLED` (Standard `true`, sonst `403 guest_auth_disabled`).
- [x] *(15.10.2026)* Rate-Limits je IP: `GUEST_LOGINS_PER_MINUTE` (10) und `GUEST_ACCOUNTS_PER_HOUR` (20 neue Konten), TESTWERT, `429 rate_limited`.
- [x] *(15.10.2026; `guest-auth.test.ts` 10 Tests, gesamt 256/256 grün)* Tests: neues Konto, gleiches Gerät, Dev + Gast gleiches Konto, ungültige IDs 400, Schalter aus 403, gesperrt 403, beide Rate-Limits, `GET /auth/token` mit Gast-Session.
- [ ] Spiel-Client: Gast-Anmeldung statt Dev-Schlüssel, wenn `guestAuth` true ist (Spiel-Repo).
- [ ] Dokploy: `GUEST_AUTH_ENABLED`, `GUEST_LOGINS_PER_MINUTE`, `GUEST_ACCOUNTS_PER_HOUR` je Umgebung setzen (Standardwerte genügen).
- [ ] Hinweis im Spiel: „Ohne Verknüpfung geht das Gastkonto mit dem Gerät verloren“ (CP1).

## P21 – Bug-Meldungen aus dem Spiel (P-033)

**Ziel:** Alle Spieler der Beta/Testphase melden Fehler direkt aus dem Spiel: Screenshot mit Markierungen und Strichen, Notiz, Kategorien, Spiel-Kontext. Admins und Moderatoren werten sie im Admin-Panel aus. Entscheidung: P-033; Konzept: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §3.7a.
**Dateien:** `packages/contracts/src/bug-report.ts` (neu), `admin.ts` (`newBugReports`, Protokoll-Aktionen), `identity.ts` (`bugReportCount`); `packages/db/prisma/schema.prisma` + Migration `bug_reports`; `apps/api/src/routes/bug-reports.ts`, `routes/admin/bug-reports.ts`, `services/{bug-reports,housekeeping}.ts`, `lib/{image,placeholder-png}.ts`, `config.ts`, `index.ts`; Test `apps/api/test/bug-reports.test.ts`; Dev-Seed; Doku.

- [x] *(16.10.2026)* Vertrag `CreateBugReportRequest` / `CreateBugReportResponse`, Admin-Schemas `AdminBugReportQuery`, `AdminBugReportList`, `AdminBugReportDetail`, `UpdateBugReportRequest`, Grenzen `BUG_REPORT_MAX_*`.
- [x] *(16.10.2026; Migration `20261015221623_bug_reports`, `db:verify` grün, 9 Migrationen, auf die lokale Dev-Datenbank eingespielt)* Tabelle `bug_reports` (Bild als `bytea`, Kaskade mit dem Spieler, `handled_by` → `auth_users`).
- [x] *(16.10.2026)* `POST /bug-reports`: Bildtyp aus den Magic Bytes, Body-Grenze 2,25 MiB nur hier, Rate-Limits je Spieler und IP (TESTWERT), gesperrt → 403.
- [x] *(16.10.2026)* Admin: Liste mit Cursor, Filtern und Zählern je Status, Detail, Bild (`Cache-Control: private`), Status setzen (Moderator, Protokoll), Löschen (Admin, Protokoll); `newBugReports` in `GET /admin/stats`; `bugReportCount` in der Lösch-Vorschau; Meldungen wandern beim Zusammenführen mit.
- [x] *(16.10.2026)* Aufbewahrung 90 Tage (TESTWERT): Aufräumen beim Start und alle 24 h (`services/housekeeping.ts`).
- [x] *(16.10.2026; `bug-reports.test.ts` 14 Tests; live gegen eigene API auf Port 8797 mit echtem PNG: Upload, Liste mit Cursor, Detail, Bild bytegleich, Status, Löschen, 413 bei 1,7-MB-PNG und 3-MB-Body)* Tests und Live-Prüfung.
- [x] *(16.10.2026; zweimal hintereinander gegen die lokale Datenbank)* Dev-Seed: 3 Meldungen mit Platzhalter-Screenshots.
- [ ] Admin-Panel: Seite „Bug-Meldungen“ (Liste mit Status-Reitern, Detail mit Bild und eingezeichneten Markierungen/Strichen, Status setzen, Löschen nur Admin), Kennzahl „neue Bug-Meldungen“ in der Übersicht; Bild serverseitig mit dem Admin-Token holen und durchreichen (admin-dev).
- [ ] Spiel: „Absenden“ im F9-Werkzeug (Haken in KONZEPT_ONLINE §3.7a; Spiel-Repo).
- [ ] Datenschutzerklärung: Zusatz „Fehlermeldungen aus dem Spiel“ bei eRecht24 und Store-Angaben (Projektmitglied).
- [ ] Dokploy: `BUG_REPORTS_PER_HOUR`, `BUG_REPORTS_PER_IP_PER_HOUR`, `BUG_REPORT_RETENTION_DAYS` nur setzen, wenn vom Standard abweichend (Integrator, `infra/DOKPLOY.md`).

## P22 – Konto-Profil statt Spielstand-Name (P-034, D-152)

**Ziel:** Ein Konto hat einen Charakter (Anzeigename + Aussehen); Spielstände sind nur Welten. Entscheidung: P-034 (D-152 im Spiel-Repo); Konzept: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §3.4a.
**Dateien:** `packages/contracts/src/{common,player,identity,guild,admin}.ts`; `packages/db/prisma/schema.prisma` + Migration `player_profile`; `apps/api/src/routes/{me,auth}.ts`, `routes/admin/players.ts`, `services/{profile,sessions,identities,guilds,account-link,housekeeping}.ts`, `auth/player-plugin.ts`; Test `apps/api/test/profile.test.ts`; Dev-Seed; Doku.

- [x] *(16.10.2026)* Vertrag `PlayerCharacter`, `PlayerAppearance`, `UpdateProfileRequest`; `appearance` in `PlayerSelf`, `GuildMember`, `AdminPlayerDetail` (+ `nameHistory`); `name` bei `/auth/device` und `/auth/dev` optional, `appearance` bei allen Logins optional.
- [x] *(16.10.2026; `db:verify` grün, 10 Migrationen, lokal eingespielt)* Migration `player_profile`: `players.appearance jsonb`, Tabelle `player_name_changes`.
- [x] *(16.10.2026)* `PATCH /me` mit Grenze 3 Namenswechsel je 24 h (TESTWERT, `429 name_change_limited`), Admin-Umbenennung ohne Grenze mit Verlauf; Verlauf 90 Tage im Aufräumjob; Zusammenführen nimmt den Verlauf mit.
- [x] *(16.10.2026; `profile.test.ts` 7 Tests, live gegen eigene API geprüft)* Tests und Live-Prüfung; Dev-Seed mit Figuren für Spieler 1–8.
- [ ] Spiel: Profil-Editor, Spielstand-Name nicht mehr an die Anmeldung schicken (Haken KONZEPT_ONLINE §3.4a).
- [ ] Admin-Panel: Figur und Namensverlauf in den Spieler-Details zeigen (admin-dev).
- [ ] Filter gegen anstößige Namen (Store-Pflicht; Baustein fehlt).

## P23 – Kosmetik im Profil (Plattform-Teil von WK2)

**Ziel:** Kosmetik (Spielfigur: Kopf, Rücken, Lichtfarbe; Wick: Hut, Flammenfarbe) reist wie das Aussehen über das Konto-Profil (`PATCH /me`, P-034), nie über Spielpakete, und ist nur Optik. Das Spiel-Paket WK2 (`soulwick/docs/ROADMAP.md`, Strang W; Konzept `soulwick/docs/KONZEPT_BEGLEITER_KOSMETIK.md` §5) braucht diesen Vertrag zuerst. Kaufbare Kosmetik und die serverseitige Besitzprüfung kommen erst mit CP6 (D-176, D-177).
**Agent:** `api-dev`. **Dateien:** `packages/contracts/src/{common,player,guild}.ts` (`PlayerAppearance` nur ergänzen, abwärtskompatibel), `apps/api/src/routes/me.ts`, `services/profile.ts`, Test `apps/api/test/profile.test.ts`, Dev-Seed; Migration nur, falls `players.appearance` (jsonb) nicht reicht. **Wartet auf** WK0 (Plätze und Teile).

- [ ] Vertrag: Kosmetik-Plätze und erlaubte Teile nach WK0; Profile ohne Kosmetik und ältere Spielversionen bleiben gültig.
- [ ] `PATCH /me`, Anmelde-Antworten und Gildenmitglieder (`GuildMember.appearance`) tragen die Kosmetik mit.
- [ ] Tests und Live-Prüfung gegen die lokale API (Profil-Test von WK2).

## P24 – Dorf-Schnappschuss (Plattform-Teil von WK6)

**Ziel:** Ein Spieler legt einen Schnappschuss seines Dorfs (Gebäudestufen, Deko mit Platz und Drehung, Zeitpunkt) auf dem Server ab; Gildenmitglieder und Freunde öffnen ihn und schauen das Dorf an, ohne etwas zu ändern. Danach baut `village-dev` die Spielseite (WK6, `soulwick/docs/ROADMAP.md`). Konzept: `soulwick/docs/KONZEPT_BEGLEITER_KOSMETIK.md` §7.
**Agent:** `api-dev`. **Dateien:** `packages/contracts` (neuer Bereich für den Schnappschuss), `packages/db/prisma/schema.prisma` + Migration, `apps/api/src/routes/`, `services/`, Tests, Dev-Seed. **Wartet auf** WK0 (wer schauen darf, OFFEN; Vorschlag: Gilde und wer den Besuchs-Link bekommt), WK5 (Deko im Spiel) und P4 (Gilden).

- [ ] Vertrag: Format mit Version und Größengrenze (Vorschlag ≤ 16 KB, TESTWERT), keine Freitexte, kein Spielstand, kein Gold.
- [ ] Tabelle und Routen: eigenen Schnappschuss ablegen und lesen, fremden nur mit Recht lesen; Rate-Limit.
- [ ] Melden und Ausblenden im Admin-Panel (admin-dev); Löschen mit dem Konto und Mitnehmen beim Zusammenführen.
- [ ] Datenschutzerklärung um den Dorf-Schnappschuss ergänzen (Projektmitglied, eRecht24).

## Später

- KI-Wunschbosse „Traumweber“ (Server-Teil laut `soulwick/docs/ROADMAP_KI_BOSS.md`).
- Rate-Limit über mehrere API-Container (z. B. Redis), falls nötig.
- Crossplay: Relay, Anmeldung, Verknüpfung und Versionen sind jetzt P13–P17; Cloud-Save (CP5) und Käufe (CP6; Geschäftsmodell entschieden in D-176, serverseitige Prüfung D-177, Preise OFFEN) bleiben später: `soulwick/docs/ROADMAP_CROSSPLAY.md`.
- Relay je Region (Raumcode mit Regions-Präfix, CP0 Frage 10, OFFEN); dedizierter Godot-Server als Container-Pool (`soulwick/docs/ROADMAP_CROSSPLAY.md` „Dedizierter Server (später)“).
