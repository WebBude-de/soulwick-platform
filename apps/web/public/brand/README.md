# Website-Grafiken (`apps/web/public/brand/`)

Das Asset-Paket aus dem Design-Handoff (`docs/design/web/HANDOFF_WEB.md`). Die Seite liest
ausschließlich die **WebP**-Dateien; gelieferte PNGs werden mit
`bun apps/web/scripts/sync-brand.ts` verlustfrei konvertiert (Keyart/OG mit Qualität 90) und
danach gelöscht. Nur `cursor.png` und `favicon-32.png` bleiben PNG.

| Pfad | Inhalt | Verwendung |
| --- | --- | --- |
| `logo.svg`, `logo_mono.svg`, `logo_square.svg` | Wortmarke 160×48, einfarbig, Quadrat 64×64 | Navbar, Footer, Icon |
| `logo.webp`, `logo_square.webp` | 4×-Pixelversionen | Fallback / Social |
| `favicon-32.png` | 32×32 | Favicon |
| `keyart.webp` (1920×1080) | Hero-Bild | Hero |
| `og_image.webp` (1200×632) | Open-Graph-Bild | Teilen-Vorschau |
| `biome_*.webp` (640×360) | Krypta, Schleimgrotte, Schattenreich, Glutkammer | Biom-Karten |
| `scenes/*.webp` (480×270) | `village`, `room_crypt`, `room_grotto`, `main_menu` | Dorf-Szene u. a. |
| `sprites/*.webp` | Website-Sprites (Streifen und Icons, inkl. `chip_*`, `divider`, `tile_*`, `arrow_loop`, `soul_flame_6f`) | überall, über `src/lib/sprite-manifest.ts` |
| `fonts/PixelifySans-Variable.ttf` + OFL | Display-Schrift | `next/font/local` |
| `copy.de.json`, `copy.en.json` | Texte der Landingpage | Quelle für `messages/*/landing.json` |

Sprites, die hier fehlen, kommen aus dem Spiel-Repo (`bun apps/web/scripts/sync-sprites.ts`
kopiert `soulwick/art/**` nach `public/sprites/**` und schreibt das Manifest; Einträge aus
`brand/sprites/` haben Vorrang).
