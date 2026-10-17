# Grafik-Briefing Website – Wick, Teilen-Bild, Store-Badges

> **Stand:** 17.10.2026 · **Anlass:** neue Positionierung (D-173 bis D-175 in `soulwick/docs/DECISIONS.md`): Freunde zuerst, Maskottchen Wick mit dem Huhn, süßes Dorf, moderne Pixel-Art. **Dorf:** Ein gemaltes Dorfbild wird nicht mehr gebraucht; „Dein Dorf“ zeigt das aktuelle Dorf als Bildschirmfoto aus dem Spiel (`village_ingame.webp`, erzeugt mit `bun apps/web/scripts/sync-village.ts`, Projektmitglied 17.10.2026: das aktuelle Dorf aus dem Spiel, so aktuell wie möglich). **Ablage:** `apps/web/public/brand/` mit genau den Dateinamen unten. Die Website prüft beim Rendern, ob die Datei da ist, und tauscht den Platzhalter **ohne Code-Änderung** aus.
> **Format (P-015):** WebP. PNG geht auch: danach `bun apps/web/scripts/sync-brand.ts` laufen lassen (Pixel-Art verlustfrei, Teilen-Bilder mit Qualität 90, die PNGs werden gelöscht). Sprite-Streifen nie verlustbehaftet.
> **Stil (D-174):** moderne Pixel-Art, nicht Retro: weiches Licht, Glow, Partikel, klare Silhouetten, keine gewollten Grafikfehler. Palette aus `soulwick/docs/HANDOUT.md`, Kontur 1 px `#1c1a2b`, kein Anti-Aliasing in Sprites. Kein Text im Bild, außer beim Teilen-Bild.

Wick ist ein **Docht-Wesen**: eine kleine lebende Kerze mit Docht und Flamme auf dem Kopf, zwei Augen, runde Wangen (D-175; Projektmitglied 17.10.2026: „Dann mach das Dochtwesen“, keine schwebende Seele). Das endgültige Aussehen ist noch **OFFEN**. Die Website zeigt bis dahin einen gezeichneten Platzhalter (`src/components/wick/wick-figure.tsx`): eine Kerze, die etwas höher als breit ist (10 px Wachs breit, 14 Reihen hoch, Augen weit oben), damit sie nicht quadratisch wirkt und trotzdem so sympathisch bleibt (Review 17.10.2026: lieber etwas größer als schlanker). Für den Entwurf gilt: lieber knuffig als dünn. Bitte die Spiel-Grafik für Wick (Briefing im Spiel-Repo unter `docs/design/sprites/`) und diese Website-Dateien aus **einem** Entwurf ableiten, damit Wick überall gleich aussieht. Achtung: Im Spiel heißt die bisherige Spielerfigur intern noch `wick` (`SPRITES_V10.md` §7a); gemeint ist hier das Maskottchen, nicht die Spielfigur.

## 1. Wick

| Datei | Größe | Was | Wo auf der Website |
| --- | --- | --- | --- |
| `wick/wick_idle_6f.webp` | 192 × 32 (6 Frames à 32 × 32), transparent | Wick im Stand: Flamme flackert, Körper atmet leicht (Squash and Stretch), einmal blinzeln. Blick nach rechts (links wird gespiegelt). Wick füllt etwa 16 × 24 px in der unteren Mitte des Frames (höher als breit), **Fußpunkt (16, 30)**, die Flamme ragt nach oben. Abspielrate 8 fps, Schleife. | Hero (folgt der Maus), Koop-Lobby, Läufer-Leiste unter dem Hero, Neuigkeiten |
| `wick/wick_hero.webp` | 512 × 512, transparent | Große Illustration von Wick (Pixel-Art auf 128 × 128 gezeichnet, ×4 ohne Glättung): freundlich, neugierig, Flamme als Lichtquelle mit warmem Schein auf dem Körper. Unten mittig stehend, etwas Luft nach oben für die Flamme. | Abschnitt „Triff Wick“ (dort klickbar, hüpft) |
| `wick/wick_chicken.webp` | 640 × 360, transparent | Wick und das Huhn zusammen, z. B. Wick reitet auf dem Huhn oder beide schauen um eine Ecke. Huhn wie im Spiel (`art/characters/npcs/chicken_*`), nur größer gezeichnet. | Kopf der Seite „Neuigkeiten“ |

## 2. Teilen-Bild (Open Graph) mit neuer Tagline

| Datei | Größe | Was |
| --- | --- | --- |
| `og_image_en.webp` | 1200 × 630 | Die vier Spielfiguren aus dem Spiel (Standardfigur, Ember, Moss, Frost; `soulwick/art/characters/`) rennen mit Wick durch einen dunklen Dungeon-Gang, warme Lichtkreise um jeden, das Huhn vorneweg. Schriftzug **SOULWICK** (wie `logo.svg`) und darunter **„Grab your friends. Light the dark.“** Text im mittleren Bereich (sicherer Rand 60 px), lesbar auch als kleine Vorschau. |
| `og_image_de.webp` | 1200 × 630 | Gleiches Motiv, Text **„Schnapp dir deine Freunde. Bring Licht ins Dunkel.“** |

Bis dahin nutzt die Seite das bisherige `og_image.webp` (ohne Tagline).

## 3. Optional

| Datei | Größe | Was |
| --- | --- | --- |
| `news/<slug>.webp` | 1200 × 630 | Titelbild für einen Beitrag unter „Neuigkeiten“; im Beitrag als `image: /brand/news/<slug>.webp` eintragen (`apps/web/content/news/README.md`). |

## 4. Store-Badges (nicht zeichnen, nur offizielle Dateien)

Store-Logos und -Badges dürfen nicht nachgezeichnet oder verändert werden (Apple: Badge unverändert, nur als Link auf die Produktseite; Google: Farbe, Proportionen und Abstände unverändert, Link auf die App, mindestens so groß wie andere Badges daneben; Valve: nur freigegebenes Steam-Artwork, unverändert, nicht kombiniert). Deshalb zeigt die Website vor dem Release eigene Pixel-Kacheln ohne fremde Logos („Browser“, „PC · Steam“, „Android“, „iPhone & iPad“, „zum Release“) und erst mit Store-Adresse und `LIVE_FEATURES` die offiziellen Dateien:

| Datei (`public/brand/stores/`) | Woher | Stand |
| --- | --- | --- |
| `google-play-badge.<en,de>.webp` | play.google.com/intl/en_us/badges/, verlustfrei nach WebP | liegt bereit |
| `app-store-badge.<en,de>.svg` | tools.applemarketingtools.com („Download on the App Store“ / „Laden im App Store“, schwarz) | offen, bitte ablegen |
| `steam-logo.svg` oder `.webp` | Valve Brand Assets (partner.steamgames.com/doc/marketing/branding) | offen, optional |

Details und Regeln: `apps/web/public/brand/README.md`.

## Nach dem Ablegen

1. Dateien nach `apps/web/public/brand/` (bzw. `wick/`, `news/`) legen; bei PNG `bun apps/web/scripts/sync-brand.ts`.
2. Seite neu laden: Die Platzhalter verschwinden automatisch. Der Name muss exakt stimmen.
3. Wenn Wicks Streifen andere Maße bekommt als 32 × 32 / 6 Frames / 8 fps, die Konstanten in `src/components/wick/wick-figure.tsx` anpassen (oder hier im Briefing die Maße festhalten und die Grafik danach richten).
