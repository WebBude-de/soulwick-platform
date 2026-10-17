# Soulwick Webseite (`@soulwick/web`)

## Zweck

Öffentliche Webseite von Soulwick („Schnapp dir deine Freunde. Bring Licht ins Dunkel.“, D-173,
D-174), zweisprachig (Englisch als Standard, Deutsch; die Sprache steht nie in der URL): Startseite für
Spieler, die Soulwick so beschreibt, wie es zum Release ist, auch schon vor dem Release (Absicht und
Aufbau: `docs/design/web/KONZEPT_WEB.md`), Neuigkeiten (Devlog),
Ranglisten (Solo, Gruppe, Gilden; Allzeit und Saison), öffentliche Gildenseiten, Open Source sowie
Datenschutz, Impressum und Konto löschen.

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
| `LIVE_FEATURES` | `true` | Live-Funktionen an/aus (`src/lib/features.ts`). Schaltet **nur** Live-Funktionen, nie Beschreibungen: `false` = keine Spielen- und Installieren-Knöpfe (auch mit `GAME_URL`), stattdessen das Schild „Zum Release spielbar“; Ranglisten-Abschnitt ohne Live-Tafeln („Die Tafeln gehen zum Release live“) und ohne API-Aufrufe; `/leaderboards` und `/guilds/[tag]` liefern 404 und fehlen in der Sitemap; die Open-Source-Seite zeigt keine Spiel-Downloads. Navigation und alle Feature-Texte bleiben gleich. Wird auf dem Server gelesen (kein `NEXT_PUBLIC_`), Umschalten ohne Neubau: Seiten pro Anfrage sofort, die vorab gebauten Neuigkeiten-Seiten spätestens nach fünf Minuten (Docker baut sie mit `false`). Dokploy: development `true`, production `false` bis zum Release |
| `GAME_URL` | leer | Adresse der Browser-Version des Spiels (`src/lib/game.ts`), z. B. `https://game-dev.playsoulwick.com`. Wirkt nur mit `LIVE_FEATURES` an (`playLinks()`): Hero zeigt „Kostenlos im Browser spielen“ und „Was dich erwartet“, darunter „Als App installieren“ (`GAME_URL?install`) und die Kachel „Browser · spielbar“; der Knopf oben rechts heißt „Spielen“, das Handy-Menü beginnt mit „Im Browser spielen“ / „Web-App installieren“, Beiträge enden mit dem Spielen-Knopf. Sonst (leer, keine http(s)-Adresse oder `LIVE_FEATURES=false`): Schild „Zum Release spielbar“, Kachel „Browser · zum Release“, oben rechts „Ranglisten“ (live), die Steam-Wunschliste (`content/stores.json`) oder „Neuigkeiten“. Links im selben Tab, kein Einbetten. Pro Anfrage auf dem Server gelesen. Dokploy: development gesetzt, production vorerst leer |

## Befehle

| Befehl | Was passiert |
| --- | --- |
| `bun run --cwd apps/web dev` | Entwicklungsserver auf Port 3000 |
| `bun run --cwd apps/web build` | Produktions-Build (`output: "standalone"`) |
| `bun run --cwd apps/web start` | Produktions-Build starten |
| `bun run --cwd apps/web typecheck` | Routen-Typen erzeugen und TypeScript prüfen |
| `bun test apps/web` | Unit-Tests der Website (Schalter `LIVE_FEATURES` und `GAME_URL` in beiden Modi, Hero mit Plattform-Kacheln und Store-Badges, Abschnitte gerendert, Release-Texte ohne Teaser-Wörter, `social.json`, `stores.json`, Sprach-Umschreibung im Proxy, statische Neuigkeiten, Cursor- und Dorfbild-Dateien, Sitemap, Seiten, Rechtstext-Rückfall, Neuigkeiten und Markdown; ohne API und Datenbank) |
| `bunx biome check apps/web` | Lint und Formatierung nur für die Website (ganzes Repo: `bun run check`, Fixes: `bun run fix`) |
| `bun apps/web/scripts/sync-sprites.ts` | Spiel-Grafiken aus `../soulwick/art` als verlustfreies WebP nach `public/sprites/` kopieren und `src/lib/sprite-manifest.ts` schreiben (`--force` kodiert alles neu); `art/store` (große Store-Grafiken) und `art/fonts` bleiben draußen. Danach auch die vier Spielfiguren (`player`, `ember`, `moss`, `frost`) aktuell |
| `bun apps/web/scripts/sync-brand.ts` | PNGs in `public/brand/**` nach WebP konvertieren (Originale werden gelöscht, `--keep-png` behält sie; Teilen-Bilder mit Qualität 90) |
| `bun apps/web/scripts/sync-cursor.ts` | Mauszeiger des Spiels (`../soulwick/art/ui/cursor_pointer.png`, `cursor_crosshair.png`) nach `public/brand/cursor/` kopieren, dazu je Bildschirmdichte (1,5×, 2×, 3×) eine Fassung mit ganzen Pixeln |
| `GODOT=… bun apps/web/scripts/sync-village.ts` | Neues Dorfbild aus dem Spiel: startet Godot leise (`SOULWICK_QUIET=1`, `--audio-driver Dummy`) mit `scripts/capture-village.gd` (Test-Spielstand, 11 Uhr, ohne HUD und Gebäudenamen) und speichert `public/brand/village_ingame.webp` (verlustfrei, 1280 × 720, unter 300 KB). Bild danach anschauen |
| `bun apps/web/scripts/sync-audio.ts` | `village.wav` und `dungeon_crypt.wav` aus `../soulwick/audio/music` mit ffmpeg nach `public/audio/` (`.ogg` und `.m4a`) wandeln |

Docker: `docker build -f apps/web/Dockerfile -t soulwick-web .` (aus dem Repo-Wurzelordner). Bun
installiert nur im Build-Stage, das Image läuft als Next standalone auf `node:24-slim`. Betrieb auf dem
Server: [infra/DOKPLOY.md](../../infra/DOKPLOY.md).

## Sprache

Die URLs sind englisch und ohne Sprache (P-012). Alle Seiten liegen unter einem versteckten
Segment `src/app/[locale]/`: `src/proxy.ts` schreibt jede Seitenanfrage intern auf
`/<sprache>/<pfad>` um (Cookie `NEXT_LOCALE` → `Accept-Language`, Deutsch → `de` → sonst `en`), die
Adresszeile bleibt gleich. So lassen sich Seiten ohne Daten pro Anfrage (die Neuigkeiten) beim Build
je Sprache vorab erzeugen. `src/i18n/request.ts` liest die Sprache aus dem Segment (`next/root-params`),
nur ohne Segment (Server Actions) aus Cookie und Header. Der Sprachschalter setzt das Cookie, merkt
die Wahl in `localStorage` (`soulwick.locale`) und lädt die Seite neu (`router.refresh()`). Alte Links
mit Präfix (`/de/ranglisten`, `/en/leaderboards` …) leitet der Proxy per 308 auf den Pfad ohne Präfix
um und setzt das Cookie auf die Präfix-Sprache; `/de/…` ist damit nie eine zweite Adresse. Unbekannte
Pfade landen in `[locale]/[...rest]` (404 mit Kopf und Fuß), Pfade außerhalb des Segments in
`src/app/global-not-found.tsx`.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/i18n/locale.ts` | `LOCALES`, `DEFAULT_LOCALE`, `Locale`, Cookie-/Storage-Namen, `localeFromAcceptLanguage` |
| `src/i18n/request.ts`, `messages.ts` | Sprache auflösen, `messages/<locale>/{common,landing,legal,leaderboards,guilds,deletion,opensource,news}.json` als Namespaces laden (Abschnitte der Startseite über `useTranslations("landing")` mit Schlüsseln wie `hero.title`; bei der Größe von `landing.json` erkennt der Typ verschachtelte Namespaces wie `landing.hero` nicht mehr) |
| `src/proxy.ts` | Sprache wählen und auf `[locale]` umschreiben, alte `/de/…`- und `/en/…`-URLs weiterleiten |
| `src/app/[locale]/layout.tsx` | `<html lang>` aus dem Segment, Navbar, Footer, Metadaten; Schriften (Pixelify Sans lokal, DM Sans) in `src/app/fonts.ts` |
| `src/app/[locale]/page.tsx` | Startseite (Abschnitte in `src/components/landing/`: Hero mit Dungeon-Bühne, Koop, Wünsch dir einen Boss, Wick, Abstieg, Dorf, Ranglisten und Gilden, Was kommt, Neuigkeiten, Fragen, Open Source) |
| `src/components/landing/hero-stage.tsx` | Client-Teil des Hero: Wick und sein Licht folgen der Maus, fliegen auf Touch zum angetippten Punkt und wandern sonst umher (`--wx`/`--wy`); ruht bei `prefers-reduced-motion` und außerhalb des Bildschirms |
| `src/components/wick/*` | Maskottchen Wick (D-175, Docht-Wesen): `WickFigure` zeichnet eine kleine Kerze als Platzhalter, bis `public/brand/wick/wick_idle_6f.webp` existiert; `WickButton` (anklickbar, hüpft und spricht); `wick.css` |
| `src/components/landing/bosses.tsx`, `wish-cycle.tsx` | „Wünsch dir einen Boss“: drei Schritte und die Wunsch-Maschine mit erfundenen Beispielen (`landing.bosses.examples`), der Knopf zeigt das nächste |
| `src/lib/social.ts`, `content/social.json`, `src/components/site/social-links.tsx` | Social-Kanäle: Datei mit zod geprüft (beim Laden, ein Fehler bricht den Build ab), nur Kanäle mit Adresse erscheinen (Footer, Neuigkeiten-Abschnitt) |
| `src/lib/stores.ts`, `content/stores.json`, `src/lib/platforms.ts`, `src/components/landing/platforms.tsx` | Store-Seiten (Steam, Google Play, App Store) und die Plattform-Kacheln im Hero: vor dem Release eigene Pixel-Kacheln „Browser“, „PC · Steam“, „Android“, „iPhone & iPad“ mit „zum Release“, ohne fremde Logos; mit `LIVE_FEATURES` und Store-Adresse das offizielle Badge aus `public/brand/stores/` unverändert als Link (App Store zuerst), sonst die eigene Kachel als Link bzw. „später“; der Steam-Eintrag ist vor dem Release auch die Wunschliste |
| `src/components/landing/figures.tsx` | Die vier Spielfiguren aus dem Spiel (Standardfigur, Ember, Moss, Frost) in Hero, Läufer-Leiste und Koop-Lobby, ohne Namen (der Spielname der Standardfigur kollidiert mit Wick) |
| `src/lib/news.ts`, `src/lib/markdown.ts`, `src/components/news/*` | Neuigkeiten aus `content/news/<slug>/<sprache>.md` (Format: README dort), kleines Markdown ohne HTML |
| `src/components/ui/sprite.tsx` | `<Sprite id scale hoverId flip frame still alt />` – CSS-`steps()`-Animation aus dem Manifest |
| `src/components/ui/*` | `PixelButton`, `PixelPanel`, `Chip`, `SectionIntro`, `SectionHeading`, `Divider`, `LanguageSwitch`, `MusicToggle`, `MusicControl` (Lautsprecher mit Lautstärke-Popover), `VolumeSlider`, `ScrollReveal`; Musikzustand und Lautstärke in `music-store.ts` (localStorage `soulwick.music`, `soulwick.music.volume`) |
| `src/components/site/*` | Kopf- und Fußzeile; unter `xl` (1280 px) klappen Links, Sprache und Musik in das Menü `MobileMenu` |
| `src/lib/brand.ts` | Prüft, welche Website-Grafiken in `public/brand/` liegen (Fallback auf Platzhalter bzw. Spiel-Sprites), u. a. das Dorfbild aus dem Spiel (`village_ingame.webp`); erwartete neue Dateien: `docs/design/web/BRIEFING_WEB.md` |
| `public/brand/cursor/` | Mauszeiger aus dem Spiel (`sync-cursor.ts`), eingebunden in `globals.css` (Pfeil) und `landing.css` (Fadenkreuz im Hero) |
| `src/lib/game.ts`, `src/components/site/play-buttons.tsx` | `GAME_URL` lesen und prüfen, `playLinks()` nur mit `LIVE_FEATURES`; Knöpfe „Im Browser spielen“ / „Web-App installieren“ (Hero und Handy-Menü) |
| `src/lib/sprite-manifest.ts` | generiert, nicht von Hand ändern |

Die erzeugten Dateien (`public/sprites/**`, `public/audio/**`, `public/brand/**`,
`src/lib/sprite-manifest.ts`) gehören ins Repo; der Build (auch Docker) braucht das Spiel-Repo
nicht. Die `sync-*`-Skripte laufen nur lokal, wenn sich Grafiken oder Musik im Spiel ändern.

## Seiten

| Pfad | Inhalt |
| --- | --- |
| `/` | Startseite (Anker `#koop`, `#bosse`, `#wick`, `#spiel`, `#biome`, `#dorf`, `#ranglisten`, `#was-kommt`, `#faq`) |
| `/news`, `/news/[slug]` | Neuigkeiten (Devlog) aus `content/news/`, beim Build je Sprache und Beitrag vorab erzeugt (kein Dateizugriff pro Anfrage; im Hintergrund alle fünf Minuten neu gebaut, damit Kopfzeile und Spielen-Knopf dem Schalter `LIVE_FEATURES` folgen); Beitrag in der Seitensprache, sonst in der anderen mit Hinweis; unbekannter Beitrag → 404. Die zwei neuesten stehen auch auf der Startseite, alle in der Sitemap |
| `/leaderboards` | Ranglisten (Query: `art`, `zeitraum`, `saison`); 404 bei `LIVE_FEATURES=false` |
| `/guilds/[tag]` | Öffentliche Gildenseite; 404 bei `LIVE_FEATURES=false` |
| `/privacy`, `/imprint` | Rechtstexte (eRecht24 über die API; ohne Text die optionale Datei aus `content/legal/`, sonst Platzhalter mit Support-Adresse aus `GET /public/config`) |
| `/delete-account` | Konto löschen ohne Anmeldung (Google Play „Datensicherheit“, P15, P-026): Spielername + Einmal-Löschcode aus dem Spiel → `POST /account-deletion/verify`, Bestätigungsschritt → `POST /account-deletion/confirm`, alles über eine Server-Action (läuft ohne JavaScript). Abschnitt „Kein Zugang mehr zum Spiel?“ immer sichtbar: mit `supportEmail` aus `GET /public/config` ein mailto-Link, sonst Verweis aufs Impressum (`SUPPORT_EMAIL` ist in Produktion Pflicht) |

## Social-Links pflegen

Die Kanäle stehen in [`content/social.json`](content/social.json), ein Eintrag je Kanal:

```json
{ "id": "discord", "label": "Discord", "url": "https://discord.gg/…" }
```

- **Eintragen:** bei `url` die volle Adresse mit `https://` setzen. Leer (`""`) heißt: Kanal gibt es
  noch nicht, er erscheint nirgends. `id` und Reihenfolge nicht ändern; `label` ist der Name auf der
  Seite (Markenname, gleich in beiden Sprachen).
- **Kanäle:** `discord`, `tiktok`, `youtube`, `instagram`, `x`, `reddit`. Store-Seiten (auch Steam)
  stehen in `content/stores.json` (unten). Ein neuer Kanal braucht Code (`SOCIAL_CHANNEL_IDS` und ein
  Pixel-Symbol in `src/components/ui/pixel-icon.tsx`).
- **Ohne Programmierumgebung:** auf GitHub im Repository `soulwick-platform` die Datei
  `apps/web/content/social.json` öffnen, Stift-Symbol („Edit this file“), Adresse eintragen,
  „Commit changes…“ (am besten auf einem eigenen Branch mit Pull Request).
- **Prüfung:** Beim Build prüft zod die Datei (nur `https://`, keine doppelten oder unbekannten
  Kanäle, keine Tippfehler bei Feldnamen); ein Fehler bricht den Build mit dem Namen des Eintrags ab.
  Lokal: `bun test apps/web`.
- **Live:** Die Datei wird in den Build eingebaut. Erst nach einem neuen Deploy (Dokploy) stehen die
  Links auf der Website.

## Store-Seiten pflegen

Die Store-Seiten stehen in [`content/stores.json`](content/stores.json), leer (`""`), solange es sie
nicht gibt:

```json
{ "steam": "https://store.steampowered.com/app/…", "google_play": "https://play.google.com/store/apps/details?id=…", "app_store": "https://apps.apple.com/app/…" }
```

- **Nur die Produktseite des jeweiligen Stores** (`store.steampowered.com`, `play.google.com`,
  `apps.apple.com`, immer `https://`); zod prüft das beim Build. Apple und Google erlauben ihre Badges
  nur als Link auf die eigene App.
- **Vor dem Release** (`LIVE_FEATURES=false`): Die Kacheln im Hero bleiben „zum Release“, ohne Links
  und ohne Store-Logos. Nur `steam` wirkt schon: „Auf die Steam-Wunschliste“ im Hero und „Wunschliste“
  oben rechts.
- **Ab dem Release** (`LIVE_FEATURES=true`): Mit Adresse und Badge-Datei in `public/brand/stores/`
  erscheint das offizielle Badge unverändert als Link (App Store zuerst, Google Play mindestens gleich
  groß), darunter der Markenhinweis des Stores. Ohne Badge-Datei bleibt die eigene Kachel als Link;
  ohne Adresse heißt die Kachel „später“. Dateinamen der Badges: `public/brand/README.md`.
- **Live:** wie `social.json` erst nach einem neuen Deploy.
