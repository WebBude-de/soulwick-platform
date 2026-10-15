# Soulwick Platform

Online-Teil von **Soulwick**, einem 2D-Dungeon-Roguelite in Godot. Das Spiel selbst liegt im
Nachbar-Repo `../soulwick` und bleibt ohne diesen Server spielbar. Hier liegt alles, was einen Server
braucht:

- **Website** [playsoulwick.com](https://playsoulwick.com): Startseite, Ranglisten, Gildenseiten,
  Kontolöschung, Rechtstexte (Englisch und Deutsch).
- **Spieler-API**: Anmeldung (Gast je Gerät, Steam, Google Play), Konten verknüpfen, Gilden,
  Run-Berichte, Ranglisten.
- **Relay** für Koop: Räume mit Raumcode, leitet Spielpakete weiter, ohne sie zu lesen.
- **Admin-Panel**: Spieler sperren, Gilden und Runs moderieren, Live-Räume, Protokolle.

## Aufbau

Bun-Workspaces mit Turborepo, Datenbank über Prisma, Lint und Format mit Biome (Ultracite-Presets),
Git-Hooks mit Husky. Details: [docs/TECHSTACK.md](docs/TECHSTACK.md).

| Ordner | Paket | Inhalt | Port lokal |
| --- | --- | --- | --- |
| `apps/web` | `@soulwick/web` | Website (Next.js, DE/EN) | 3000 |
| `apps/admin` | `@soulwick/admin` | Admin-Panel (Next.js) | 3001 |
| `apps/api` | `@soulwick/api` | Spieler- und Admin-API (Hono auf Bun) | 8787 |
| `apps/relay` | `@soulwick/relay` | WebSocket-Relay für Koop (Bun) | 8790 |
| `packages/contracts` | `@soulwick/contracts` | API- und Relay-Verträge (zod), Quelle der Wahrheit für alle Apps und den GDScript-Client | – |
| `packages/db` | `@soulwick/db` | Prisma-Schema, Migrationen, Client (nur die API nutzt es) | – |
| `packages/config` | `@soulwick/config` | gemeinsame TypeScript-Konfiguration | – |
| `infra/` | – | nur **lokale** Dienste (`docker-compose.yml`: Postgres) und die Server-Anleitung `DOKPLOY.md` | 5432 |

## Schnellstart lokal

Voraussetzungen: [Bun](https://bun.sh) 1.3, Node 24 (Next.js läuft darauf), Docker.

```bash
bun install                                    # Abhängigkeiten, richtet auch die Husky-Hooks ein
cp .env.example .env.local                     # gemeinsame Werte: BETTER_AUTH_SECRET, RELAY_INTERNAL_KEY, DEV_AUTH_KEY eintragen
cp apps/api/.env.example apps/api/.env.local
cp apps/relay/.env.example apps/relay/.env.local
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp infra/.env.example infra/.env.local         # Port und Passwort des lokalen Postgres
bun run services:up                            # nur Postgres (Container soulwick-postgres, Port 5432)
bun run db:deploy                              # Migrationen einspielen
bun run db:seed:dev                            # Testdaten: Admins, Spieler, Gilde, Runs, Sperre, Löschprotokoll
bun dev                                        # Web 3000, Admin 3001, API 8787, Relay 8790
```

Stoppen: `bun run services:down` (die Daten bleiben im Docker-Volume). Einzeln starten:
`bun run dev:api`, `dev:web`, `dev:admin`, `dev:relay`. Ist Port 5432 belegt, in `infra/.env.local`
`DB_PORT` ändern und `DATABASE_URL` in der Root-`.env.local` anpassen.

**Aufbau der `.env`-Dateien** (alle außer `.env.example` sind gitignored):

| Ort | `.env.example` | `.env.local` | `.env.dev` / `.env.prod` |
| --- | --- | --- | --- |
| Wurzel | Vorlage | gemeinsame Werte lokal (URLs, Datenbank, Geheimnisse, Versionen) | Dokploy: Variablen der Umgebung `development` / `production` |
| `apps/<app>/` | Vorlage | Werte der App lokal, gewinnt über die Wurzel | Dokploy: **Environment** des Services (mit `${{environment.NAME}}`) |
| `infra/` | Vorlage | lokaler Postgres-Container | – (auf den Servern nicht genutzt) |

API, Relay und Prisma laden erst die Wurzel-`.env.local`, dann die eigene darüber. Geheimnisse erzeugen z. B. mit
`openssl rand -base64 48`.

**Zugänge nach dem Seed:** Admin `admin@soulwick.local`, Moderator `moderator@soulwick.local`, Passwort
`soulwick-admin-local` (oder `DEFAULT_ADMIN_PASSWORD`). Spieler-Login für Tests:
`POST /auth/device` mit `{ "deviceId": "<UUID>", "name": "Lumen" }` (Gast, ohne Schlüssel) oder
`POST /auth/dev` mit Header `x-dev-auth-key: <DEV_AUTH_KEY>` und
`{ "name": "Lumen", "deviceId": "dev-device-00000001" }` (Seed-Spieler). Ersten echten Admin anlegen:
`bun run --cwd apps/api admin:create <email> <passwort> admin`.

Das Spiel im Godot-Editor spricht automatisch mit `localhost:8787` (API) und `localhost:8790` (Relay).

## Prüfen

| Was | Befehl |
| --- | --- |
| Formatieren und Lint-Fixes | `bun run fix` |
| Lint und Format prüfen (Biome) | `bun run check` |
| Typen | `bun run typecheck` |
| Tests (API und Relay; API gegen den lokalen Postgres mit Wegwerf-Datenbank je Lauf) | `bun test` (braucht `bun run services:up`) |
| Bauen | `bun run build` |
| Migrationen gegen das Schema prüfen | `bun run db:verify` |
| Zustand der lokalen Datenbank | `bun run db:status` |
| Ein Image wie auf dem Server bauen | `docker build -f apps/<app>/Dockerfile .` |

Neue Migration: Schema in `packages/db/prisma/schema.prisma` ändern, dann
`bun run db:migrate --name <name>`. Husky formatiert beim Commit die gestagten Dateien und prüft vor dem
Push die Migrationen, wenn Schema oder Migrationen geändert wurden.

## Deployment

Jede App läuft auf Dokploy als eigene Application aus ihrem Dockerfile, dazu eine Postgres-Datenbank je
Umgebung. Zwei Umgebungen mit je eigener Datenbank, eigenen Geheimnissen und eigenem Relay:
`development` unter `dev.playsoulwick.com`, `api.dev.…`, `admin.dev.…`, `play.dev.…` und `production`
ohne Präfix. Schritt-für-Schritt-Anleitung: [infra/DOKPLOY.md](infra/DOKPLOY.md).

## Doku

| Datei | Wofür |
| --- | --- |
| [../soulwick/docs/PRODUKT.md](../soulwick/docs/PRODUKT.md) | Produktüberblick für **beide** Repos: Pitch, Säulen, Begriffe (im Spiel-Repo) |
| [docs/PRD.md](docs/PRD.md) | Was die Plattform leisten muss, für wen, was nicht |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Aufbau, Datenmodell, Abläufe |
| [docs/TECHSTACK.md](docs/TECHSTACK.md) | Werkzeuge, Richtlinien, alle Befehle und Variablen |
| [docs/KONZEPT_ONLINE.md](docs/KONZEPT_ONLINE.md) | Relay-Protokoll, Anmeldung über die Stores, Versionen, lokales Testen |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Pakete und Stand |
| [docs/DECISIONS.md](docs/DECISIONS.md) | technische Entscheidungen (P-Nummern); Produkt-Entscheidungen (D-Nummern) stehen in `../soulwick/docs/DECISIONS.md` |
| [docs/design/README.md](docs/design/README.md) | Design-Tokens, Handoffs und Mockups je App |
| [infra/DOKPLOY.md](infra/DOKPLOY.md) | Betrieb auf dem Server, Test-Build für Freunde |
| [AGENTS.md](AGENTS.md) | Zusammenarbeit mit KI-Agenten |
