# TECHSTACK – Soulwick Platform

> **Stand:** 15.10.2026 (Bun, Turborepo, Prisma, Better Auth). Gegenstück zu `soulwick/docs/TECHSTACK.md` (Spiel). Versionen und Begründungen: [DECISIONS.md](DECISIONS.md) P-001 ff., Umstellung P-009 bis P-011, Auth P-027. Der Ordner `infra/` enthält nur die lokalen Dienste (Postgres) und die Dokploy-Anleitung.

## 1. Kernstack

| Baustein | Wahl | Anmerkung |
| --- | --- | --- |
| Laufzeit | **Bun 1.3** (`packageManager` im Root-`package.json`), Bun-Workspaces mit hoisted Linker (`bunfig.toml`) | P-009; Next.js läuft lokal und im Container auf Node 24 (`.nvmrc`) |
| Monorepo | **Turborepo** (`turbo.json`: `dev`, `build`, `typecheck`, `generate`) | Task-Graph und Cache; `bun dev` startet alles. Workspaces: `apps/api`, `apps/relay`, `apps/web`, `apps/admin`, `packages/contracts`, `packages/db`, `packages/config` |
| Sprache | TypeScript ~6.0, ESM, `strict` | 7.x noch nicht (P-001) |
| API | Hono 4 auf **Bun** (`Bun.serve`), Client-IP über `@hono/bun` | kleine, typisierte HTTP-Schicht |
| Relay | **Bun** (`Bun.serve` mit WebSocket-Handler), `apps/relay` | Räume im Speicher, Binärrahmen weiterleiten (P-016); Vertrag `packages/contracts/src/lobby.ts` |
| Datenbank | PostgreSQL 17, **Prisma 7.10** (`packages/db`, Generator `prisma-client`, `@prisma/adapter-pg`), Migrationen in `packages/db/prisma/migrations` | P-010; nur `apps/api` importiert `@soulwick/db` |
| Validierung | zod 4 in `@soulwick/contracts` | Request/Response-Verträge für alle Apps |
| Auth | **Better Auth** ^1.7 (wie DapItUp) mit Prisma-Adapter, Plugins `admin`, `bearer`, `jwt` und eigenem Plugin `soulwickPlayerAuth`; Admins E-Mail/Passwort (argon2id über `Bun.password`), Spieler über Plattform-Identitäten; Session-Token als `Authorization: Bearer`; der Relay prüft kurzlebige Spieler-JWTs (EdDSA) mit `jose` gegen die JWKS der API | P-027; Better-Auth-Handler nicht gemountet, nur Hono-Routen |
| Website / Admin | Next.js 16 (App Router), React 19, Tailwind 4, `output: "standalone"` | |
| i18n (Website) | **next-intl**, Locales `en` (Standard) und `de`, ohne Sprache im Pfad (Cookie `NEXT_LOCALE`), Texte in `apps/web/messages/{de,en}/*.json` | P-012 |
| Bilder (Website) | **WebP** überall; `sharp` nur als devDependency für das Sprite-Skript (`apps/web/scripts/sync-sprites.ts`) | P-015; keine Bildverarbeitung zur Laufzeit |
| Rechtstexte | eRecht24 Rechtstexte-API v2, Abruf durch die API mit Speicher-Cache (24 h, Fehler 60 s), HTML-Bereinigung mit Bun-`HTMLRewriter` | P-013, P-025 |
| Tests | **`bun test`** (API und Relay); API gegen den lokalen Docker-Postgres (Wegwerf-Datenbank je Lauf) | P-011; braucht `bun run services:up` |
| Lint / Format | Biome 2.5 mit Ultracite 7 (Presets `core`, `react`, `next`), Husky 9 (`pre-commit`, `pre-push`) | `biome.jsonc`; ersetzt ESLint und Prettier (P-007) |
| Build | `next build` für Web und Admin; API und Relay starten direkt aus der Quelle (`bun src/index.ts`), ohne Bundle | |
| Container | Docker, Docker Compose nur für lokale Dienste, Dokploy (VPS); API- und Relay-Image `oven/bun:1.3.14`, Web/Admin `node:24-slim` + Next standalone (Bun nur im Build-Stage) | Build-Kontext immer die Repo-Wurzel |

## 2. Programmierrichtlinien

- **Code, Bezeichner, Kommentare: Englisch. Texte auf Website und im Admin-Panel: Deutsch**, die Website zusätzlich Englisch über die Message-Dateien (keine Texte im Code). Doku Deutsch.
- Dateinamen `kebab-case.ts`, Typen und Schemas `PascalCase`, Funktionen `camelCase`.
- **Verträge zuerst:** Keine Route ohne Schema in `packages/contracts`. Routen validieren Eingaben nur über diese Schemas; Services bekommen typisierte Werte.
- **Schichten:** `routes` (HTTP) → `services` (Fachlogik, ohne Hono-Objekte) → `@soulwick/db` (Prisma-Client). Querschnitt in `lib`. Kein Datenbankzugriff außerhalb von `services`/`scripts`.
- **Datenbank nur über Migrationen:** Schema in `packages/db/prisma/schema.prisma` ändern, dann `bun run db:migrate --name <name>`; kein `prisma db push`. Bestehende Migrationen nie nachträglich ändern; `bun run db:verify` muss vor dem Push grün sein.
- Fehler als `ApiError(status, code, message)`; Antwortform `{ error, message, ... }`. Keine Stacktraces nach außen.
- Geheimnisse nie im Code oder in Tests; Konfiguration nur über `config.ts` (validiert).
- Zeit, Zufall und HTTP injizierbar (`Deps.now`, `Deps.fetch`), damit Tests deterministisch sind (gilt auch für den eRecht24-Client).
- Keine Abhängigkeit ohne Grund; neue Pakete im Bericht nennen.
- **Formatierung und Lint-Regeln kommen aus Biome** (`bun run fix` schreibt, `bun run check` prüft; 80 Zeichen, 2 Leerzeichen, Interfaces statt Typ-Aliase für Objekttypen, keine `!`-Assertions, `withCause` beim Umwandeln gefangener Fehler). Ausnahmen nur in `biome.jsonc` mit einzeiliger Begründung; `biome-ignore` nur mit Grund.

## 3. Git

- Branch-Modell und Commit-Präfixe wie im Spiel-Repo (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`; `feature/*` von `dev`, Pull Request mit Review, siehe [CONTRIBUTING.md](../CONTRIBUTING.md)). Hauptbranch hier: `main`; Remote auf GitHub `WebBude-de/soulwick-platform` (öffentlich, Code GPL-3.0, Inhalte siehe [LICENSE-ASSETS.md](../LICENSE-ASSETS.md)). Dokploy baut `development` aus dem Dev-Branch und `production` aus dem Branch `production` ([infra/DOKPLOY.md](../infra/DOKPLOY.md) §10).
- **Versioniert:** Quellcode, `bun.lock`, Migrationen in `packages/db/prisma/migrations/`, erzeugte Sprites in `apps/web/public/sprites/`, `.env.example`, Dockerfiles, Doku.
- **Nicht versioniert:** `node_modules/`, `.next/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `next-env.d.ts`, `packages/db/generated/`, `.turbo/`, `.env` und `.env.*` außer `.env.example` (siehe `.gitignore`).
- Kein Commit und kein Push durch Agenten ohne ausdrückliche Freigabe.
- **Husky-Hooks** (installiert durch `bun install` über `prepare`):
  - `pre-commit`: formatiert und lint-fixt die gestagten Dateien mit `bunx biome`; teilweise gestagte Dateien lässt er unberührt und listet sie.
  - `pre-push`: führt `bun run db:verify` aus, wenn `packages/db/prisma/schema.prisma` oder die Migrationen gegenüber dem Upstream geändert wurden (braucht den lokalen Postgres).
  - Umgehen nur bewusst mit `--no-verify`.

## 4. Befehle

| Was | Befehl (im Repo-Root) |
| --- | --- |
| Abhängigkeiten | `bun install` (richtet auch die Husky-Hooks ein) |
| Lokale Dienste starten / stoppen | `bun run services:up` / `bun run services:down` (Postgres `soulwick-postgres` auf Port 5532 aus `infra/docker-compose.yml`, Werte aus `infra/.env`) |
| Alle Apps entwickeln | `bun dev` (Turbo: API 3101, Web 3100, Admin 3102, Relay 3103, Port-Block 1 nach P-035; Postgres aus `services:up`) |
| Einzeln | `bun run dev:api` / `bun run dev:web` / `bun run dev:admin` / `bun run dev:relay` |
| Images bauen (wie Dokploy) | `docker build -f apps/api/Dockerfile .`, ebenso `apps/relay`, `apps/web`, `apps/admin` (kein Compose für die Apps) |
| Formatieren und Lint-Fixes | `bun run fix` (`biome check --write .`) |
| Lint und Formatierung prüfen | `bun run check` (`biome check .`) |
| Typen prüfen | `bun run typecheck` (Turbo, nach `generate`) |
| Tests | `bun test` (Root-Skript mit `--timeout 30000`; API gegen den Docker-Postgres, Wegwerf-Datenbank je Lauf; Relay ohne Datenbank) |
| Bauen | `bun run build` |
| Migration anlegen und anwenden | `bun run db:migrate --name <name>` (nach Schemaänderung in `packages/db/prisma/schema.prisma`) |
| Migrationen nur anwenden | `bun run db:deploy` (so startet auch das API-Image) |
| Datenbank neu aufsetzen | `bun run db:reset` (löscht lokal alles, spielt Migrationen und Seed ein) |
| Prisma-Client erzeugen | `bun run db:generate` (Turbo-Task `generate`, läuft vor `build`/`typecheck` automatisch) |
| Datenbank ansehen | `bun run db:studio` |
| Zustand der Datenbank | `bun run db:status` (nur lesend: angewandte und fehlende Migrationen) |
| Migrationen prüfen | `bun run db:verify` (baut alle Migrationen in einer Wegwerf-DB und vergleicht mit dem Schema; läuft im `pre-push`) |
| Testdaten einspielen | `bun run db:seed:dev` (idempotent, verweigert `NODE_ENV=production`; siehe `apps/api/README.md`) |
| Ersten Admin anlegen | `DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD` setzen, dann `bun run db:seed` (im API-Image bei jedem Start; vorhandene Konten bleiben unverändert) |
| Sprites für die Website erzeugen | `bun apps/web/scripts/sync-sprites.ts` (aus `../soulwick/art/` nach `public/sprites/`, verlustfreies WebP; `--force` kodiert alles neu) |
| Compose prüfen | `docker compose -f infra/docker-compose.yml config` |

Mindestens vor jedem Bericht: `bun run check`, `bun run typecheck`, `bun test`, `bun run build`.

## 5. Umgebungsvariablen

| App | Variablen |
| --- | --- |
| api | `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥ 32 Zeichen, P-027), `BETTER_AUTH_URL` (öffentliche Basis-URL der API, in production https), `PORT`, `PLAYER_TOKEN_TTL_DAYS`, `ADMIN_TOKEN_TTL_HOURS`, `DEV_AUTH_ENABLED`, `DEV_AUTH_KEY`, **Gast (P-028):** `GUEST_AUTH_ENABLED`, `GUEST_LOGINS_PER_MINUTE`, `GUEST_ACCOUNTS_PER_HOUR`; `STEAM_WEB_API_KEY`, `STEAM_APP_ID`, `STEAM_TICKET_IDENTITY`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `MIN_SECONDS_PER_ROOM`, `KNOWN_GAME_VERSIONS`, `LOG_LEVEL`; **Stores (P14):** `GOOGLE_PLAY_CLIENT_ID`, `GOOGLE_PLAY_CLIENT_SECRET`, `EXTERNAL_AUTH_TIMEOUT_MS`; **Konten (P15):** `LINK_ATTEMPTS_PER_MINUTE`, `DELETION_REQUESTS_PER_HOUR`; **Versionen und Relay (P16):** `MIN_GAME_VERSION`, `PROTOCOL_VERSION`, `RELAY_PUBLIC_URL`, `RELAY_INTERNAL_KEY`; **Admin → Relay (P18):** `RELAY_INTERNAL_URL` (leer = Live-Räume aus, gesetzt nur zusammen mit `RELAY_INTERNAL_KEY`), `RELAY_INTERNAL_TIMEOUT_MS`; **Rechtstexte (P-025):** `ERECHT24_API_KEY` und `ERECHT24_PLUGIN_KEY` (beide nötig, sonst `status: "missing"`); **Kontolöschung (P-026):** `SUPPORT_EMAIL` (optional, leer = keine Support-Adresse in `GET /public/config`); **Basis-Seed (Start-Admin):** `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD` (auch Dev-Seed); nur Tests: `TEST_DATABASE_URL` |
| relay | `PROTOCOL_VERSION`, `API_INTERNAL_URL` (interne Adresse der API, Pflicht: JWKS für das Spieler-JWT, P-027), `JWKS_URL` (optional, Standard `<API_INTERNAL_URL>/auth/jwks`), `JWKS_CACHE_SECONDS` (600, TESTWERT), `RELAY_INTERNAL_KEY` (gleich wie die API), `RELAY_PORT` (lokal 3103, Image 8790), `RELAY_HOST`, `TRUST_PROXY`, `LOG_LEVEL`, `STATUS_CACHE_SECONDS`, `API_TIMEOUT_MS`, `CLIENT_ROUTING`; Grenzen (TESTWERTE): `MAX_FRAME_BYTES`, `MAX_CONTROL_BYTES`, `MAX_MESSAGES_PER_SECOND`, `MAX_BYTES_PER_SECOND`, `RATE_LIMIT_STRIKES`, `MAX_CONNECTIONS_PER_IP_PER_MINUTE`, `MAX_BUFFERED_BYTES`, `ROOM_IDLE_MINUTES`, `IDLE_MINUTES`, `HELLO_TIMEOUT_SECONDS`, `HEARTBEAT_INTERVAL_SECONDS`, `HEARTBEAT_TIMEOUT_SECONDS`; nur lokal: `RELAY_SIM_LATENCY_MS`, `RELAY_SIM_LOSS` |
| db (`packages/db`) | `DATABASE_URL` (für Prisma CLI, `db:status`, `db:verify`; `db:verify` legt daraus eine Wegwerf-Datenbank ab) |
| web | `API_URL` (serverseitig), `SITE_URL` (öffentliche Basis-URL für Metadaten, Sitemap, Open Graph; `https://playsoulwick.com`) |
| admin | `API_URL`, `ADMIN_COOKIE_SECURE` |
| infra (Compose, nur lokal) | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DB_PORT` (Standard 5532; kein Objektspeicher) |

Vorlagen: `apps/*/.env.example`, `infra/.env.example`. Produktive Werte nur in Dokploy (zwei Umgebungen `development` und `production`, Variablen als `${{environment.NAME}}`; siehe [infra/DOKPLOY.md](../infra/DOKPLOY.md)).

## 6. Bewusst nicht im Stack

- **Nur Bun** als Paketmanager und Skriptläufer (Bun-Workspaces + Turborepo, P-009); Node bleibt nur Laufzeit der Next-Apps.
- **Nur Prisma** als Datenbankschicht (`packages/db`, P-010); kein `prisma db push`, nur Migrationen.
- **Keine Datenbank im Testprozess**: Tests laufen gegen den Docker-Postgres (P-011).
- Kein ESLint, kein Prettier (Biome mit Ultracite-Presets übernimmt Lint und Formatierung).
- Kein Redis / keine Queue (Rate-Limit im Speicher reicht für einen Container).
- Kein Client-seitiger API-Zugriff aus dem Browser (nur Server Components/Actions).
- Kein Gameserver mit Spiellogik: Das Spiel bleibt host-autoritativ. Für Crossplay gibt es den eigenen WebSocket-Relay `apps/relay` (Bun), der nur weiterleitet (D-119, P-016, Paket P13; Konzept: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md)). Ein dedizierter Godot-Server ist erst später vorgesehen.
- Keine Bildverarbeitung zur Laufzeit (WebP wird vorab erzeugt), kein `next/image`-Optimierer für Pixel-Art.
