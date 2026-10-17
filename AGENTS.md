# AGENTS.md – Soulwick Platform

> **Stand:** 17.10.2026 · Gilt für jeden Agenten und jeden neuen Chat in diesem Repo. Die gemeinsame
> Arbeitsweise (Rollen Orchestrator/Fach-Agent/Integrator, Pakete mit Besitzliste, Berichte) steht in
> `../soulwick/AGENTS.md` und gilt hier genauso. Diese Datei ergänzt nur, was für die Plattform
> besonders ist.

## 1. Erst lesen

1. [README.md](README.md): was das Repo ist, Aufbau, Schnellstart.
2. `../soulwick/docs/PRODUKT.md`: Produktkontext für beide Repos (Zielgruppe, Ton, Maskottchen Wick,
   Geschäftsmodell, Open Source); Begriffe in `../soulwick/docs/GLOSSAR.md`.
3. [docs/PRD.md](docs/PRD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
   [docs/TECHSTACK.md](docs/TECHSTACK.md), [docs/ROADMAP.md](docs/ROADMAP.md),
   [docs/DECISIONS.md](docs/DECISIONS.md).
4. Je nach Aufgabe: [docs/KONZEPT_ONLINE.md](docs/KONZEPT_ONLINE.md) (Relay, Anmeldung, Versionen),
   [infra/DOKPLOY.md](infra/DOKPLOY.md) (Server), [docs/design/README.md](docs/design/README.md) (UI;
   `web-dev`/`admin-dev` zusätzlich [docs/design/TOKENS.md](docs/design/TOKENS.md); `web-dev` liest
   [docs/design/web/KONZEPT_WEB.md](docs/design/web/KONZEPT_WEB.md) statt des abgelösten Handoffs und
   [docs/design/web/BRIEFING_WEB.md](docs/design/web/BRIEFING_WEB.md), `admin-dev`
   [docs/design/admin/README.md](docs/design/admin/README.md)).
5. Die README des Ordners, in dem gearbeitet wird (`apps/*/README.md`, `packages/contracts/README.md`).
6. Produkt-Entscheidungen im Spiel-Repo `../soulwick/docs/DECISIONS.md` (v. a. D-080 bis D-085, D-093,
   D-108, D-119, D-121, D-122 und D-173 bis D-179: Zielgruppe, Ton, Wick, Geschäftsmodell, Code offen
   und Inhalte geschützt, Doku-Regel, Reihenfolge), die Phasen-Übersicht `../soulwick/docs/ROADMAP.md`
   und `../soulwick/docs/ROADMAP_MULTIPLAYER.md` (MP7–MP9).

## 2. Regeln

1. **Kein Commit und kein Push**, außer das Projektmitglied sagt es ausdrücklich.
2. **Verträge zuerst:** Neue oder geänderte Routen und Relay-Nachrichten beginnen in
   `packages/contracts` (zod-Schema + Typ). API, Relay, Web und Admin nutzen nur diese Typen. Danach den
   GDScript-Client im Spiel-Repo anpassen oder als Haken für den Integrator beschreiben.
3. **Abwärtskompatibel:** Das Spiel wird nicht überall gleichzeitig aktualisiert. Felder nur ergänzen,
   nicht umbenennen oder entfernen, solange die vorige Spielversion sie nutzt; sonst `API_VERSION`
   (bzw. beim Relay `PROTOCOL_VERSION` zusammen mit dem Spiel) erhöhen.
4. **Datenbank nur über Migrationen:** Schema in `packages/db/prisma/schema.prisma` ändern, dann
   `bun run db:migrate --name <name>`; die erzeugten Ordner gehören ins Repo. Kein `prisma db push`,
   bestehende Migrationen nie ändern, `bun run db:verify` muss grün sein. Migrationen bleiben
   rückwärtskompatibel zum laufenden Container ([infra/DOKPLOY.md](infra/DOKPLOY.md) §9).
5. **Tests nur gegen Wegwerf-Datenbanken.** `bun test` und `db:verify` legen eigene Datenbanken an. Die
   lokale Datenbank des Projektmitglieds nie zurücksetzen (`db:reset`, `prisma migrate reset`, Volume
   `soulwick-pgdata` löschen), außer es verlangt das ausdrücklich.
6. **Prozesse nie per Name beenden** (kein `taskkill /IM node.exe`, `pkill bun`, `docker stop` fremder
   Container). Nur eigene Prozesse über ihre PID stoppen; den Postgres-Container laufen lassen.
7. **Geheimnisse** nur in nicht versionierten `.env*`-Dateien (gitignored) bzw. in Dokploy; im Repo nur
   `.env.example`. Keine echten Personendaten in Tests, Seeds oder Beispielen.
8. **Admin-Aktionen** prüfen immer die Rolle (`admin` / `moderator`) und schreiben ins Protokoll (`audit_log`).
9. **Datenschutz:** nur Plattform-Identitäten (Steam, Gerät, später Google Play und Game Center), Name,
   Gilde und Run-Berichte speichern; der Relay protokolliert keine Paketinhalte.
10. **Sprache:** Code, Bezeichner und Kommentare Englisch; Doku Deutsch; Texte im Admin-Panel Deutsch,
    auf der Website über die Message-Dateien Englisch und Deutsch.
11. **Keine neue Abhängigkeit** ohne Freigabe; neue Pakete im Bericht nennen.
12. **Dateien nicht verschieben, umbenennen oder löschen** ohne Auftrag; Vorschläge in den Bericht.

## 3. Gemeinsame Hotspots

Nur der Integrator oder ein Agent nach dem anderen ändert: Root-`package.json`, `bun.lock`,
`turbo.json`, `bunfig.toml`, `biome.jsonc`, `packages/contracts`, `packages/db/prisma` (Schema und
Migrationen), `infra/` (Compose und `DOKPLOY.md`), `docs/DECISIONS.md`.

**Doku-Besitz:** `docs/design/<app>/HANDOFF_<APP>.md` und die Mockups schreibt nur das Projektmitglied
(Ausgabe von Claude Design), Agenten lesen sie. `docs/design/TOKENS.md`, `docs/design/README.md` und
`../soulwick/docs/PRODUKT.md` ändert nur der Integrator. Neue P-Nummer: vorher die höchste vorhandene in
`docs/DECISIONS.md` suchen.

## 4. Agenten

Definitionen in [.claude/agents/](.claude/agents/) (Frontmatter wie in DapItUp, Text Englisch). Der
Orchestrator startet sie mit dem Agent-Werkzeug (`subagent_type` = Name) und nennt Paket und Besitzliste.

| Agent | Besitz | Darf nicht |
| --- | --- | --- |
| `api-dev` | `apps/api`, `apps/relay`, `packages/contracts`, `packages/db`; einziger Agent, der Vertrag und Schema ändert; pflegt Tests und Dev-Seed | Web, Admin, `infra/`, Root-Dateien |
| `web-dev` | `apps/web` (außer `public/brand/`, das liefert das Projektmitglied) | API, Verträge, Admin |
| `admin-dev` | `apps/admin`; Token bleibt im httpOnly-Cookie, API-Aufrufe nur serverseitig | API, Verträge, Web |

Fehlende Routen oder Felder melden `web-dev` und `admin-dev` als „Requests for api-dev“, statt sie selbst
zu bauen. Infrastruktur, Root-Dateien und Doku außerhalb der Apps macht der Integrator.

**Bericht** (fest): Summary, Files changed, Contract changes / Requests for api-dev, Migrations,
New environment variables, How verified (Befehle + Ergebnisse), Open points.

## 5. Lokal arbeiten

Ablauf und Zugänge: [README.md](README.md) „Schnellstart lokal“. Kurz: `.env.example` kopieren →
`bun install` → `bun run services:up` (nur Postgres, Port 5432) → `bun run db:deploy` →
`bun run db:seed:dev` → `bun dev` (Web 3000, Admin 3001, API 8787, Relay 8790). Läuft der Dev-Server des
Projektmitglieds schon, eigene Instanzen auf anderen Ports starten (z. B. `PORT=8797`), nicht dessen
Prozesse beenden. Mehr zum Seed: [apps/api/README.md](apps/api/README.md).

## 6. Prüfen vor jedem Bericht

`bun run fix` → `bun run check` (0 Fehler) → `bun run typecheck` → `bun test` (braucht
`bun run services:up`) → `bun run build`. Zusätzlich bei Schemaänderungen `bun run db:verify`, bei
Dockerfile-Änderungen `docker build -f apps/<app>/Dockerfile .`, bei Compose-Änderungen
`docker compose -f infra/docker-compose.yml config`.

Lint-Regeln kommen aus den Ultracite-Presets in `biome.jsonc`. Eine Regel wird nur dort mit einzeiliger
Begründung abgeschaltet; `biome-ignore` nur mit Grund und nur, wenn der Typ-Checker es erzwingt.

## 7. Offene Punkte (Stand 15.10.2026)

- Deployment auf Dokploy ist beschrieben, aber noch nicht auf dem Server erprobt (P2, P17;
  [infra/DOKPLOY.md](infra/DOKPLOY.md)).
- Rate-Limits und Relay-Räume liegen im Speicher, deshalb je genau eine Replica.
- Impressum und Datenschutz kommen über eRecht24 (P10); bis zu den Schlüsseln zeigt die Website Platzhalter.
- `/auth/steam` und `/auth/google-play` sind nur mit Fake-`fetch` getestet (eigene Steam-AppID MP10,
  Play „Interner Test“ CP7).
- Annahmen P-101 bis P-109 in [docs/DECISIONS.md](docs/DECISIONS.md) sind vom Team zu bestätigen.
