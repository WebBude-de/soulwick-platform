# Soulwick Website – HANDOFF (Landingpage)

Stand 14.10.2026. Dieses Dokument übergibt das Design der Landingpage an `apps/web`. Es ergänzt `PRD.md` §3.4 (zweisprachig, WebP, Graceful Degradation) und `docs/HANDOUT.md` (Palette, Sprite-Regeln).

Referenz-Mockups: `docs/design/web/landing_desktop_de.png` (1280 px), `landing_desktop_en.png`, `landing_mobile_de.png` (390 px). Der interaktive Prototyp ist `Soulwick-Landing.dc.html` (Sprache per Tweak, Hover-Effekte, Ranglisten-Tabs).

## 1. Assets – `apps/web/public/brand/`

Alles liegt fertig im Ordner `website/public/brand/`, 1:1 kopieren.

| Pfad | Inhalt |
| --- | --- |
| `logo.svg`, `logo_square.svg`, `logo_mono.svg` | Wortmarke 160×48 (Grid), Quadrat 64×64, einfarbig für Footer. SVG mit `shape-rendering: crispEdges`, beliebig skalierbar |
| `logo.png`, `logo_square.png`, `favicon-32.png` | 4×-PNGs und Favicon |
| `keyart.png` (1920×1080), `og_image.png` (1200×630) | Hero-Bild und Open-Graph-Bild |
| `biome_*.png` (640×360) | Krypta, Schleimgrotte, Schattenreich, Glutkammer |
| `scenes/village.png`, `room_crypt.png`, `room_grotto.png`, `main_menu.png` (480×270) | Szenen-Renders, auf der Seite 2× skaliert |
| `sprites/*.png` | 90 Sprites und Streifen (Liste in §4) |
| `fonts/PixelifySans-Variable.ttf` + OFL | Display-Schrift |
| `copy.de.json`, `copy.en.json` | Alle Texte der Landingpage, Schlüssel wie im Prototyp |

**WebP (P-015):** Alle PNGs vor dem Build nach WebP konvertieren, Pixel-Art **verlustfrei**: `cwebp -lossless -z 9 in.png -o out.webp`. Keyart/OG dürfen verlustfrei bleiben (≈ 100–200 KB) oder `-q 90`. Sprite-Streifen niemals verlustbehaftet (Kanten verschmieren, `steps()`-Animation zeigt Nachbarframes).

## 2. Design-Tokens

```css
--bg: #1e1b2c;        /* Seite */
--bg-deep: #15131f;   /* Wechsel-Abschnitte, Hero-Verlauf */
--bg-footer: #0f0d18;
--panel: #2a2638;     /* Karten */
--line: #3b3650;      /* Rahmen 2 px */
--line-light: #5d577a; --line-lighter: #8f88ad;
--ink: #1c1a2b;       /* Kontur, Textschatten, Button-Rahmen */
--text: #e9e4d2; --text-soft: #d9d2e8; --muted: #b9b3c9; --disabled: #7a7396;
--gold: #f2cf4a; --gold-dark: #c99a2e; --gold-light: #fff0a8;
--violet: #a66ef0; --violet-link: #a98cf5;
--attr: #6cb2ec; --mech: #5fcd62; --effect: #ff8a3c; --danger: #e0463a; --crystal: #2fb391;
```

Typografie
- Display: **Pixelify Sans** (700 für H1/H2, 400 für Eyebrows, Zahlen, Chips). H1 `clamp(38px, 5vw, 60px)`, H2 `clamp(30px, 3.6vw, 42px)`, Kartentitel 20–22 px, Eyebrow 14 px Versalien mit `letter-spacing: 0.08em`. Überschriften mit `text-shadow: 2px 2px 0 var(--ink)` (H1: 3 px).
- Fließtext: **DM Sans** (Google Fonts, 400/500/700). Lead 17–18 px / 1.6, Karten 14 px / 1.55, Fußnoten 12–13 px.
- Links `--violet-link`, Hover unterstrichen (`text-underline-offset: 3px`).

Pixel-Komponenten
- **Karte**: `background: var(--panel); border: 2px solid var(--line); border-radius: 4px; box-shadow: 0 4px 0 #0f0d18`. Hover: `border-color` auf Akzent, `translateY(-3px)`.
- **Primär-Button**: Gold, Text `--ink`, 700, `box-shadow: 0 0 0 2px var(--ink), 0 4px 0 2px var(--ink), inset 0 -4px 0 var(--gold-dark)`; Hover `background: var(--gold-light)`, `translateY(2px)` und Schatten auf `0 2px`. Sekundär: `--panel` mit `inset 0 0 0 2px var(--line-light)`.
- **Chip**: `background: var(--bg-deep); border: 2px solid var(--line); border-radius: 3px; font: 14px Pixelify Sans`, 16-px-Icon links. Status „geplant“ als innerer Teil mit `chip_planned.png`.
- **Bild-Rahmen** (Hero, Dorf): gestapelte `box-shadow`-Ringe `0 0 0 3px #1c1a2b, 0 0 0 6px #8f88ad, 0 0 0 9px #5d577a, 0 0 0 12px #1c1a2b`. Hero-Bild um −1,2° gedreht.
- **Trenner**: `divider.png` (32×8) als `background: repeat-x`, 2× skaliert (64×16).
- Alle Pixelbilder mit `image-rendering: pixelated` und **ganzzahligen** Skalierungen (2×, 3×).

## 3. Seitenaufbau (Reihenfolge = Scroll)

| # | Abschnitt | Anker | Inhalt |
| --- | --- | --- | --- |
| 0 | Navbar (sticky, `rgba(21,19,31,.94)` + blur) | – | Logo 36 px · Links Spiel/Waffen/Biome/Dorf/Koop & Gilden/Ranglisten · Sprachschalter DE/EN (Pixel-Segment) · CTA „Ranglisten“ mit Trophäen-Icon. Unter 760 px Containerbreite wandern die Links in eine zweite, horizontal scrollbare Zeile |
| 1 | Hero | `#top` | Eyebrow mit animierter Seelenflamme · H1 · Lead · 2 CTAs · Plattform-Chips PC/Mobil/Crossplay, jeweils „geplant“, Hinweistext ohne Store-Logos (D-108) · Keyart im Pixelrahmen mit HUD-Herzen · **Bodenleiste** mit Walkern (s. §5) |
| 2 | Kern-Loop | `#spiel` | 5 Karten Dorf → Dungeon → Fünferzyklus → Boss → Lagerfeuer mit Sprite-Vitrine und Pfeilen (horizontal scrollbar auf Mobil) · Gold-Hinweis-Leiste (100 % / 50 % / bleibt im Run) |
| 3 | Waffen & Upgrades | `#waffen` | 3 Waffenkarten mit Spieler + Waffe; Hover spielt den Angriff (Schwung / Pfeil / Explosion) · 3 Upgrade-Kategorien mit Farbkante Attribut/Mechanik/Effekt · Fußnote Limits |
| 4 | Biome | `#biome` | 4 Karten mit Biom-Render, biom-eigener Fackel (animiert, Lichtschein flackert) und Boss-Plakette (Porträt 48 px) |
| 5 | Dorf | `#dorf` | Szene 16:9 mit lebenden NPCs (Schmied, Bäuerin, Huhn, Katze, Laternen) · Liste Schmiede/Handel/Chronik/Gildenhaus (geplant)/Zuhause |
| 6 | Koop & Gilden | `#koop` | Eyebrow mit „geplant“ · Karte Koop (4 Spieler, Host-Icon) · Karte Gilden (Wappenleiste, Gildenhaus, Chips Kasse/Schmiede/Rangliste) |
| 7 | Ranglisten-Teaser | `#ranglisten` | Umschalter Saison/Allzeit · Tabs Solo/Gruppe/Gilden · 5 Zeilen (Platz, Name + Unterzeile, Raum, Zeit); Platz 1 hervorgehoben, Trophäe/Münze · Link „Alle Ranglisten“ |
| 8 | Footer | – | Logo mono, Kurztext, Spiel-Links, Impressum/Datenschutz mit eRecht24-Hinweis, © · Huhn läuft auf der Oberkante |

Routen (P-012): `/de` ↔ `/en`; Anker-Ziele bleiben sprachneutral. Ranglisten-Teaser verlinkt auf `/de/ranglisten` bzw. `/en/leaderboards`, Gilden-Chips auf `/de/gilden/[tag]` ↔ `/en/guilds/[tag]`, Rechtstexte auf `/de/impressum`, `/de/datenschutz` ↔ `/en/imprint`, `/en/privacy`.

## 4. Sprite-Animation im Web

Alle Streifen laufen über ein Außen-Element mit `overflow: hidden` in Framegröße × Skalierung und ein Innen-Element in Streifenbreite, das mit `steps()` nach links läuft:

```css
@keyframes strip { to { transform: translateX(-100%); } }
.sprite { width: 96px; height: 96px; overflow: hidden; }              /* 32 px × 3 */
.sprite > div { width: 384px; height: 96px;                            /* 4 Frames */
  background: url(/brand/sprites/player_idle_4f.png) 0 0 / 384px 96px no-repeat;
  image-rendering: pixelated; animation: strip 1s steps(4) infinite; } /* dur = frames / fps */
```

| Datei | Frame | Frames | fps | Einsatz |
| --- | --- | --- | --- | --- |
| `soul_flame_6f` | 32×48 | 6 | 8 | Hero-Eyebrow (2× = 24×36 Ausschnitt), Logo-Begleiter |
| `player_idle_4f` / `player_walk_6f` | 32×32 | 4 / 6 | 4 / 10 | Waffenkarten, Koop, Hero-Walker |
| `slime_walk_6f`, `skeleton_walk_6f`, `golem_walk_6f` (48×48) | 32×32 | 6 | 8 / 10 / 6 | Hero-Walker |
| `smith_idle_4f`, `villager_1_walk_6f`, `chicken_walk_4f` (16), `cat_idle_4f` (16), `lamp_post_4f` (16×48) | – | 4–6 | 4–8 | Dorf-Szene, Katze am Keyart, Huhn im Footer |
| `campfire_6f`, `upgrade_altar_4f` (32×48), `gold_coin_4f` (16), `torch_4f`, `torch_green_4f`, `torch_purple_4f`, `brazier_4f` | – | 4–6 | 6–8 | Loop-Karten, Gold-Leiste, Biom-Fackeln |
| `sword_swing_4f` (48), `explosion_6f` (96), `arrow` (16×5), `magic_orb_4f` (16) | – | 1–6 | 12–16 | Hover-Effekte der Waffenkarten |
| Statisch: `sword`, `bow`, `staff` (32), Boss-Porträts (48), `dungeon_entrance` (64), `forge`, `guild_hall`, `icon_*`, `upgrade_*`, `heart_*`, `chip_*`, `arrow_loop` (24×16), `divider` (32×8), `tile_floor`, `tile_floor_2`, `tile_grass` | | | | |

fps und Pivots jeder Datei stehen in den JSONs neben den Originalen (`soulwick/art/**/<name>.json`).

## 5. Easter Eggs und Bewegung

1. **Hero-Boden**: Spieler, Schleim, Skelett und Golem laufen von links nach rechts über die Bodenleiste (`@keyframes cross { from { left: -12% } to { left: 104% } }`, 26 s linear, Startversatz −6 / −4,6 / −3,4 / −1,4 s). Boden = `tile_floor.png` 2× repeat-x mit heller Kante oben.
2. **Katze auf dem Keyart-Rahmen** (oben rechts, gespiegelt): Klick zeigt 1,4 s eine Sprechblase „Miau.“ / „Meow.“.
3. **Waffenkarten**: Hover setzt den Effekt auf `opacity: 1` und lässt ihn loopen (Schwung 16 fps, Explosion 12 fps, Pfeil statisch). Hinweis „Hover: Angriff“ steht oben rechts in der Vitrine.
4. **Biom-Karten**: Fackel 4 Frames + radialer Lichtschein mit `flicker` 1,2 s.
5. **Loop-Pfeile** wippen (`bob` 1,6 s), **Dorf-Szene** hat lebende NPCs, **Footer-Huhn** läuft in 40 s über die Oberkante.
6. Optionaler Pixel-Cursor `cursor.png` (12×16, Hotspot 0 0) nur auf Desktop mit `(pointer: fine)`.

Regeln: Alle Animationen laufen über `animation-play-state` und werden bei `prefers-reduced-motion: reduce` pausiert (erster Frame bleibt sichtbar). Walker und Huhn liegen in `pointer-events: none`-Containern. Keine Animation über Text. Kein Autoplay-Ton.

## 6. Zustände und Degradation

- Ranglisten-Teaser: Lädt `GET /leaderboards?board=solo|group|guild&period=season|all` (Top 5). Lädt es nicht, bleibt die Tafel mit der Fußzeile „Ranglisten sind gerade nicht erreichbar“ und einem leeren Zustand (Skelett-Icon, Text), kein Fehler. Platz 1 bekommt Trophäe und helle Zeile, 2–3 Münze.
- Fehlende Grafik: `alt`-Text plus `--panel`-Fläche; Sprites per `onerror` ausblenden.
- Rechtstexte: `GET /legal/:type` in der Sprache; bei `status: missing` zeigt die Seite den Platzhalter aus `legalNote`.
- Sprachschalter wechselt zwischen `/de/...` und `/en/...` mit gleichem Pfadnamen-Mapping; Texte aus `copy.<lang>.json`.
- Plattform-Chips bleiben „geplant“, bis echte Store-Links existieren (dann Chip-Status `chip_done.png` und Link).

## 7. Barrierefreiheit und Performance

- Kontrast: Text auf `--panel`/`--bg` ≥ 7:1, Gold auf `--ink` 11:1, gedämpfter Text `--muted` 7,5:1. `--disabled` nur für Dekoration und „geplant“-Metadaten.
- Sprites sind dekorativ (`alt=""`, `aria-hidden`), Buttons haben Textlabel, Tabs sind `button`s mit `aria-selected`.
- Alle Streifen zusammen < 150 KB als lossless WebP; Keyart als `<img loading="eager" fetchpriority="high">`, alles unter dem Fold `loading="lazy"`.
- Schriften selbst hosten (Pixelify Sans liegt bei, DM Sans aus Google Fonts herunterladen), `font-display: swap`.

## 8. Dateien dieses Pakets

```
website/
  HANDOFF.md                  (diese Datei)
  public/brand/               (→ apps/web/public/brand/)
docs/design/web/              (Mockups: Desktop DE/EN 1280 px, Mobil DE 390 px, Hero- und Mobil-Ausschnitt)
Soulwick-Landing.dc.html      (klickbarer Prototyp, Sprache und Bewegung per Tweak)
Landing-Mockups.dc.html       (Render-Seite für die Mockups)
```
