# Website-Grafiken (`apps/web/public/brand/`)

Das Asset-Paket aus dem Design-Handoff (`docs/design/web/HANDOFF_WEB.md`). Die Seite liest
ausschließlich die **WebP**-Dateien; gelieferte PNGs werden mit
`bun apps/web/scripts/sync-brand.ts` verlustfrei konvertiert (Keyart/OG mit Qualität 90) und
danach gelöscht. PNG bleiben nur `favicon-32.png`, `sprites/cursor.png` (alter Zeiger aus dem Handoff, nicht mehr eingebunden) und `cursor/` (Mauszeiger aus dem Spiel, CSS-Cursor brauchen PNG).

| Pfad | Inhalt | Verwendung |
| --- | --- | --- |
| `logo.svg`, `logo_mono.svg`, `logo_square.svg` | Wortmarke 160×48, einfarbig, Quadrat 64×64 | Navbar, Footer, Icon |
| `logo.webp`, `logo_square.webp` | 4×-Pixelversionen | Fallback / Social |
| `favicon-32.png` | 32×32 | Favicon |
| `keyart.webp` (1920×1080) | Hero-Bild | Hero |
| `og_image.webp` (1200×632) | Open-Graph-Bild | Teilen-Vorschau |
| `biome_*.webp` (640×360) | Krypta, Schleimgrotte, Schattenreich, Glutkammer | Biom-Karten |
| `scenes/*.webp` (480×270) | `village`, `room_crypt`, `room_grotto`, `main_menu` | Rückfall fürs Dorf u. a. |
| `village_ingame.webp` (1280×720) | Das Dorf bei Tag als Bildschirmfoto aus dem Spiel (`scripts/sync-village.ts`) | Abschnitt „Dein Dorf“ |
| `cursor/pointer*.png`, `cursor/crosshair*.png` | Mauszeiger aus dem Spiel, 1× wie im Spiel plus 1,5×, 2×, 3× (`scripts/sync-cursor.ts`) | ganze Seite (Pfeil), Dungeon im Hero (Fadenkreuz) |
| `sprites/*.webp` | Website-Sprites (Streifen und Icons, inkl. `chip_*`, `divider`, `tile_*`, `arrow_loop`, `soul_flame_6f`) | überall, über `src/lib/sprite-manifest.ts` |
| `fonts/PixelifySans-Variable.ttf` + OFL | Display-Schrift | `next/font/local` |
| `stores/` | Offizielle Store-Badges, **unverändert** (siehe unten) | Hero, erst mit `LIVE_FEATURES` und Store-Adresse |
| `copy.de.json`, `copy.en.json` | Texte der Landingpage | Quelle für `messages/*/landing.json` |

Sprites, die hier fehlen, kommen aus dem Spiel-Repo (`bun apps/web/scripts/sync-sprites.ts`
kopiert `soulwick/art/**` nach `public/sprites/**` und schreibt das Manifest; Einträge aus
`brand/sprites/` haben Vorrang).

## Store-Badges (`stores/`)

Offizielle Dateien der Stores, nie nachgezeichnet, eingefärbt, beschnitten oder verzerrt (Apple,
Google und Valve verbieten das). Die Seite zeigt sie erst, wenn `LIVE_FEATURES` an ist und
`content/stores.json` die Store-Seite enthält; bis dahin stehen dort eigene Pixel-Kacheln ohne fremde
Logos. Fehlt eine Datei, bleibt auch danach die eigene Kachel. Sprache: `.<en|de>.`, fehlt Deutsch,
nimmt die Seite Englisch.

| Datei | Quelle | Stand |
| --- | --- | --- |
| `google-play-badge.en.webp`, `google-play-badge.de.webp` (646 × 250) | Google-Play-Badges (play.google.com/intl/en_us/badges/, `en_badge_web_generic.png` / `de_badge_web_generic.png`), verlustfrei nach WebP, pixelgleich geprüft | liegt bereit (17.10.2026) |
| `app-store-badge.en.svg`, `app-store-badge.de.svg` | Apple Marketing Tools (tools.applemarketingtools.com, „Download on the App Store“ bzw. „Laden im App Store“, schwarz), SVG wie geliefert | **offen**: aus der Agenten-Umgebung nicht erreichbar, bitte herunterladen und ablegen |
| `steam-logo.svg` (oder `.webp`) | Steam-Logo aus Valves Brand Assets (partner.steamgames.com/doc/marketing/branding), unverändert und allein stehend | **offen**, optional: Valve liefert nur EPS; ohne Datei bleibt die eigene Kachel „PC · Steam“ als Link |
