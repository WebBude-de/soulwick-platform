# Design-Tokens – Website und Admin-Panel

> **Stand:** 14.10.2026 · **Gilt für:** `apps/web` **und** `apps/admin`. **Quelle:** Übergabe aus Claude Design [web/HANDOFF_WEB.md](web/HANDOFF_WEB.md) §2 (Tokens, Typografie, Komponenten) und §7 (Kontrast); Palette und Pixel-Regeln stammen aus dem Spiel-Handout `../../../soulwick/docs/HANDOUT.md` (dort auch Biom-Töne, Material- und Akzentfarben des Spiels). Neue Werte zuerst hier eintragen, dann im Code; Änderungen nur durch den Integrator.

**Das Admin-Panel nutzt dieselben Tokens, aber ruhiger:** keine Easter Eggs, keine Sprite-Animationen, keine Lichtschein-Effekte; dichte Tabellen und Formulare, Statuschips und Pixel-Buttons aus §3, Gold nur für Fokus und Primäraktionen. Details: [admin/README.md](admin/README.md).

## 1. Farben

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

| Token | Verwendung |
| --- | --- |
| `--bg`, `--bg-deep`, `--bg-footer` | Seitenhintergrund, abwechselnde Abschnitte, Fußzeile |
| `--panel`, `--line`, `--line-light`, `--line-lighter` | Karten, Tabellen, Rahmen (2 px), Bild-Rahmen |
| `--ink` | Konturen, Textschatten der Pixel-Schrift, Button-Rahmen, Text auf Gold |
| `--text`, `--text-soft`, `--muted`, `--disabled` | Fließtext, weicher Text, Nebentext; `--disabled` nur Dekoration und „geplant“-Metadaten |
| `--gold`, `--gold-dark`, `--gold-light` | Titel, Zahlen, Primär-Button, Fokus; dunkel für Münzen und Button-Unterkante, hell für Hover |
| `--violet`, `--violet-link` | Magie/Waffe als Kategorie, Links |
| `--attr`, `--mech`, `--effect` | Upgrade-Kategorien Attribut (blau), Mechanik (grün), Effekt (orange) |
| `--danger`, `--crystal` | Schaden/Gefahr/Sperren, Seelenkristall |

Biom-Töne (Karten, Hintergründe): Krypta `#4a4560`, Schleimgrotte `#3f5a4a`, Schattenreich `#2e2640`, Glutkammer `#2f2a2a` (Handout).

## 2. Typografie

- **Display: Pixelify Sans** (Google Fonts, liegt im Asset-Paket als `fonts/PixelifySans-Variable.ttf` + OFL). 700 für H1/H2, 400 für Eyebrows, Zahlen und Chips. H1 `clamp(38px, 5vw, 60px)`, H2 `clamp(30px, 3.6vw, 42px)`, Kartentitel 20–22 px, Eyebrow 14 px in Versalien mit `letter-spacing: 0.08em`. Überschriften mit `text-shadow: 2px 2px 0 var(--ink)` (H1: 3 px).
- **Fließtext: DM Sans** (Google Fonts, 400/500/700). Lead 17–18 px / 1.6, Karten und Tabellen 14 px / 1.55, Fußnoten 12–13 px.
- Links in `--violet-link`, Hover unterstrichen (`text-underline-offset: 3px`).
- Schriften selbst hosten, `font-display: swap`.

## 3. Pixel-Komponenten

| Komponente | Regel |
| --- | --- |
| **Karte** | `background: var(--panel); border: 2px solid var(--line); border-radius: 4px; box-shadow: 0 4px 0 #0f0d18`. Hover (nur Web): `border-color` auf Akzent, `translateY(-3px)` |
| **Primär-Button** | Gold, Text `--ink`, 700; `box-shadow: 0 0 0 2px var(--ink), 0 4px 0 2px var(--ink), inset 0 -4px 0 var(--gold-dark)`. Hover `background: var(--gold-light)`, `translateY(2px)`, Schatten auf `0 2px` |
| **Sekundär-Button** | `--panel` mit `inset 0 0 0 2px var(--line-light)`, sonst wie Primär |
| **Chip** | `background: var(--bg-deep); border: 2px solid var(--line); border-radius: 3px; font: 14px Pixelify Sans`, 16-px-Icon links. Status „geplant“ als innerer Teil (`chip_planned.png`), „fertig“ `chip_done.png` |
| **Bild-Rahmen** | gestapelte `box-shadow`-Ringe `0 0 0 3px #1c1a2b, 0 0 0 6px #8f88ad, 0 0 0 9px #5d577a, 0 0 0 12px #1c1a2b` |
| **Trenner** | `divider.png` (32×8) als `background: repeat-x`, 2× skaliert (64×16) |

## 4. Pixel-Skalierung

- Alle Pixelbilder mit `image-rendering: pixelated` und **ganzzahligen** Skalierungen (2×, 3×); Grundraster 8 px, bei 3× sind 24 px die natürliche Einheit für Abstände.
- Sprite-Streifen laufen als CSS `steps()`-Animation (Außen-Element `overflow: hidden` in Framegröße × Skalierung, Innen-Element in Streifenbreite); fps und Pivots stehen in den JSONs neben den Originalen (`soulwick/art/**/<name>.json`). Beispiel und Dateiliste: [web/HANDOFF_WEB.md](web/HANDOFF_WEB.md) §4.
- Bilder als WebP (P-015): Pixel-Art **verlustfrei** (`cwebp -lossless -z 9`), Szenen dürfen `-q 90`. Sprite-Streifen nie verlustbehaftet.
- Bewegung läuft über `animation-play-state` und pausiert bei `prefers-reduced-motion: reduce` (erster Frame bleibt). Keine Animation über Text, kein Autoplay-Ton.

## 5. Kontrast und Barrierefreiheit

- Text auf `--panel`/`--bg` ≥ 7:1; Gold auf `--ink` 11:1; `--muted` 7,5:1. `--disabled` nie für Pflichttext.
- Dekorative Sprites mit `alt=""` und `aria-hidden`; Buttons mit Textlabel; Tabs als `button` mit `aria-selected`.
- Fokus sichtbar: Goldrahmen (2 px `--gold`) auf jedem interaktiven Element, auch im Admin-Panel.

## 6. Anwendung im Admin-Panel

- Seitenhintergrund `--bg`, Inhaltsflächen `--panel`, Tabellenlinien `--line`; Zebra-Zeilen mit `--bg-deep`.
- Tabellen 14 px DM Sans, Zahlen und Kennungen (IDs, Kürzel, Zeiten) in Pixelify Sans 400; Spaltenköpfe als Eyebrow.
- Aktionen: Primär-Button nur für die Hauptaktion der Seite; destruktive Aktionen (sperren, auflösen, löschen) als Sekundär-Button mit `--danger`-Rahmen und Bestätigung.
- Status als Chip: aktiv (`--mech`), gesperrt (`--danger`), markiert (`--effect`), fehlt/offen (`--muted`).
- Keine Hover-Hebung, keine Walker, keine Lichtschein-Effekte; Bewegung nur für Lade- und Erfolgszustände.
