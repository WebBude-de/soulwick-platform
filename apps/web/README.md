# Soulwick Webseite (`@soulwick/web`)

## Zweck

Öffentliche Webseite von Soulwick („Das letzte Licht im endlosen Dunkel“), zweisprachig
(Englisch als Standard, Deutsch; die Sprache steht nie in der URL): Landingpage nach `docs/design/web/HANDOFF_WEB.md` (Teaser, keine Spielanleitung),
Ranglisten (Solo, Gruppe, Gilden; Allzeit und Saison), öffentliche Gildenseiten sowie Datenschutz
und Impressum.

Next.js 16 (App Router) mit Tailwind CSS v4 und next-intl. Daten kommen serverseitig von der API
(`API_URL`); ist die API nicht erreichbar, zeigen die Seiten einen freundlichen Hinweis. Der Build
braucht keine API.

## Start (lokal)

```bash
bun install                                    # im Repo-Wurzelordner
cp apps/web/.env.example apps/web/.env.local   # API_URL anpassen
bun run dev:web                                # http://localhost:3000 (alles zusammen: bun dev)
```

Für echte Daten muss die API laufen (`bun run services:up`, `bun run db:deploy`, `bun run db:seed:dev`,
`bun run dev:api`, siehe [README.md](../../README.md)).

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `API_URL` | `http://localhost:8787` | Adresse der API (nur serverseitig genutzt) |
| `SITE_URL` | `https://playsoulwick.com` | Öffentliche Basis-URL für Canonical, Sitemap und Open Graph |
| `LIVE_FEATURES` | `true` | Online-Teile an/aus (`src/lib/features.ts`). `false` = reiner Teaser: `/leaderboards` und `/guilds/[tag]` liefern 404, Ranglisten-Teaser, Header-Knopf, Nav-/Footer-Link und Sitemap-Eintrag fallen weg, keine Ranglisten-Aufrufe an die API. Wird pro Anfrage auf dem Server gelesen (kein `NEXT_PUBLIC_`), Umschalten ohne Neubau. Dokploy: development `true`, production `false` |

## Befehle

| Befehl | Was passiert |
| --- | --- |
| `bun run --cwd apps/web dev` | Entwicklungsserver auf Port 3000 |
| `bun run --cwd apps/web build` | Produktions-Build (`output: "standalone"`) |
| `bun run --cwd apps/web start` | Produktions-Build starten |
| `bun run --cwd apps/web typecheck` | Routen-Typen erzeugen und TypeScript prüfen |
| `bun test apps/web` | Unit-Tests der Website (Schalter `LIVE_FEATURES`, Sitemap, Seiten, Rechtstext-Rückfall; ohne API und Datenbank) |
| `bunx biome check apps/web` | Lint und Formatierung nur für die Website (ganzes Repo: `bun run check`, Fixes: `bun run fix`) |
| `bun apps/web/scripts/sync-sprites.ts` | Spiel-Grafiken aus `../soulwick/art` als verlustfreies WebP nach `public/sprites/` kopieren und `src/lib/sprite-manifest.ts` schreiben (`--force` kodiert alles neu) |
| `bun apps/web/scripts/sync-brand.ts` | PNGs in `public/brand/**` nach WebP konvertieren (Originale werden gelöscht, `--keep-png` behält sie) |
| `bun apps/web/scripts/sync-audio.ts` | `village.wav` und `dungeon_crypt.wav` aus `../soulwick/audio/music` mit ffmpeg nach `public/audio/` (`.ogg` und `.m4a`) wandeln |

Docker: `docker build -f apps/web/Dockerfile -t soulwick-web .` (aus dem Repo-Wurzelordner). Bun
installiert nur im Build-Stage, das Image läuft als Next standalone auf `node:24-slim`. Betrieb auf dem
Server: [infra/DOKPLOY.md](../../infra/DOKPLOY.md).

## Sprache

Ohne Sprach-Routing (next-intl „without i18n routing“): Die URLs sind englisch und ohne Präfix.
`src/i18n/request.ts` wählt die Sprache pro Anfrage: Cookie `NEXT_LOCALE` (`en`/`de`) →
`Accept-Language` (Deutsch → `de`) → `en`. Der Sprachschalter setzt das Cookie, merkt die Wahl in
`localStorage` (`soulwick.locale`) und rendert die Seite neu (`router.refresh()`). Alte Links mit
Präfix (`/de/ranglisten`, `/en/leaderboards` …) leitet `src/proxy.ts` per 308 auf den Pfad ohne
Präfix um und setzt das Cookie auf die Präfix-Sprache.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/i18n/locale.ts` | `LOCALES`, `DEFAULT_LOCALE`, `Locale`, Cookie-/Storage-Namen, `localeFromAcceptLanguage` |
| `src/i18n/request.ts`, `messages.ts` | Sprache auflösen, `messages/<locale>/{common,landing,legal,leaderboards,guilds,deletion}.json` als Namespaces laden |
| `src/proxy.ts` | Nur Weiterleitung alter `/de/…`- und `/en/…`-URLs |
| `src/app/layout.tsx` | `<html lang>` nach aufgelöster Sprache, Schriften (Pixelify Sans lokal, DM Sans), Navbar, Footer, Metadaten |
| `src/app/page.tsx` | Landingpage (Abschnitte in `src/components/landing/`) |
| `src/components/ui/sprite.tsx` | `<Sprite id scale hoverId flip frame still alt />` – CSS-`steps()`-Animation aus dem Manifest |
| `src/components/ui/*` | `PixelButton`, `PixelPanel`, `Chip`, `SectionIntro`, `SectionHeading`, `Divider`, `LanguageSwitch`, `MusicToggle`, `MusicControl` (Lautsprecher mit Lautstärke-Popover), `VolumeSlider`, `ScrollReveal`; Musikzustand und Lautstärke in `music-store.ts` (localStorage `soulwick.music`, `soulwick.music.volume`) |
| `src/components/site/*` | Kopf- und Fußzeile; unter `xl` (1280 px) klappen Links, Sprache und Musik in das Menü `MobileMenu` |
| `src/lib/brand.ts` | Prüft, welche Website-Grafiken in `public/brand/` liegen (Fallback auf Spiel-Sprites) |
| `src/lib/sprite-manifest.ts` | generiert, nicht von Hand ändern |

Die erzeugten Dateien (`public/sprites/**`, `public/audio/**`, `public/brand/**`,
`src/lib/sprite-manifest.ts`) gehören ins Repo; der Build (auch Docker) braucht das Spiel-Repo
nicht. Die `sync-*`-Skripte laufen nur lokal, wenn sich Grafiken oder Musik im Spiel ändern.

## Seiten

| Pfad | Inhalt |
| --- | --- |
| `/` | Landingpage (Anker `#spiel`, `#waffen`, `#biome`, `#dorf`, `#koop`, `#ranglisten`) |
| `/leaderboards` | Ranglisten (Query: `art`, `zeitraum`, `saison`); 404 bei `LIVE_FEATURES=false` |
| `/guilds/[tag]` | Öffentliche Gildenseite; 404 bei `LIVE_FEATURES=false` |
| `/privacy`, `/imprint` | Rechtstexte (eRecht24 über die API; ohne Text die optionale Datei aus `content/legal/`, sonst Platzhalter mit Support-Adresse aus `GET /public/config`) |
| `/delete-account` | Konto löschen ohne Anmeldung (Google Play „Datensicherheit“, P15, P-026): Spielername + Einmal-Löschcode aus dem Spiel → `POST /account-deletion/verify`, Bestätigungsschritt → `POST /account-deletion/confirm`, alles über eine Server-Action (läuft ohne JavaScript). Abschnitt „Kein Zugang mehr zum Spiel?“ immer sichtbar: mit `supportEmail` aus `GET /public/config` ein mailto-Link, sonst Verweis aufs Impressum (`SUPPORT_EMAIL` ist in Produktion Pflicht) |
