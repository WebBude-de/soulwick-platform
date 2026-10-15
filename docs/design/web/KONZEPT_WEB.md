# Website-Konzept Soulwick (playsoulwick.com)

> **Hinweis (14.10.2026):** Für Layout und Komponenten der Landingpage sind die Übergabe [HANDOFF_WEB.md](HANDOFF_WEB.md) und die Mockups in diesem Ordner **verbindlich**; die gemeinsamen Design-Tokens stehen in [../TOKENS.md](../TOKENS.md). Dieses Konzept bleibt für die Begründung (§1), die Seitenstruktur jenseits der Landingpage (Spielseite §5, Ranglisten und Gildenseiten §6, Rechtsseiten §7, 404 in §8), die Mockup-Liste (§10) und die offenen Fragen (§12). Weicht das Konzept vom Handoff ab, gilt der Handoff. Am 14.10.2026 aus `docs/` hierher verschoben und umbenannt.
>
> **Überholt (15.10.2026):** Die **Spielseite** (§5) entfällt, die Website ist ein Teaser ohne Anleitung (Projektmitglied 14.10.2026, [../../PRD.md](../../PRD.md) §4). Die Sprache steht **nicht** im Pfad: englische Pfade für beide Sprachen, Sprache aus Cookie oder Browsersprache (P-012); Angaben zu `/de` und `/en` unten gelten nicht mehr. Dazu gekommen ist `/delete-account` (P-026).

> **Stand:** 14.10.2026 · **Zweck:** Grundlage für die Mockups (Claude Design) und für die Umsetzung in `apps/web` (ROADMAP P9). Palette, Maßstab und Namen kommen aus `soulwick/docs/HANDOUT.md`; Spielinhalte aus `soulwick/docs/PRD.md`, `KONZEPT_RAEUME.md`, `KONZEPT_ENDLOS.md`. Gelieferte Grafiken: `soulwick/docs/SPRITES_V5.md` §8 → `apps/web/public/brand/`.

## 1. Ziel und Ton

- **In 60 Sekunden verstanden:** Was ist Soulwick, wie läuft ein Run, warum will ich das spielen. Danach ein klarer nächster Schritt (Spiel entdecken, Ranglisten, später Download).
- **Das Spiel zeigt sich selbst:** Sprites, Panels, Türen und Figuren kommen aus `art/`, keine Stock-Illustrationen. Die Website sieht aus wie ein Menü des Spiels, das man „aufgeklappt“ hat.
- **Dunkel, warm, verspielt, übersichtlich:** Lila-schwarzer Grund, alles Wichtige leuchtet in Gold (Kerze, Titel, Knöpfe). Pro Abschnitt eine Botschaft, höchstens drei Sätze, dann Bild. Details und Easter Eggs belohnen Hinsehen, drängen sich aber nie auf.
- **Ehrlich:** Koop, Gilden, Ranglisten, Crossplay und Stores sind „geplant“ und werden so beschriftet. Keine Preise, keine Termine, keine Store-Badges ohne echte Links.
- Sprache: **Englisch ist die Hauptsprache** (`.com`, internationales Publikum), Deutsch (du) die zweite; `/` erkennt die Browsersprache (deutsche Browser → `/de`, alle anderen → `/en`), gleiche Struktur in beiden Sprachen, Umschalter behält die Seite. Das Spiel bekommt dieselben zwei Sprachen (Paket UX3 im Spiel-Repo).

## 2. Visuelle Sprache

Verbindliche Werte (Farben, Schriften, Komponenten): [../TOKENS.md](../TOKENS.md) nach dem Handoff; Fließtext ist dort **DM Sans**. Die Tabelle bleibt als Lesefassung des ursprünglichen Konzepts.

| Thema | Vorgabe |
| --- | --- |
| Palette | Grund `#15131f`, Seite `#1e1b2c`, Panel `#2a2638`, Rahmen `#3b3650` / `#5d577a` / `#8f88ad`; Text `#e9e4d2`, gedämpft `#b9b3c9`, deaktiviert `#7a7396`; Gold `#f2cf4a` (Titel, Fokus, Zahlen), Gold dunkel `#e0b84a` / `#c99a2e`; Akzente: Schaden `#e0463a`, Schild/Attribut `#6cb2ec`, Mechanik `#5fcd62`, Effekt/Feuer `#ff8a3c`, Magie/Waffe `#a66ef0`, Kristall `#2fb391` / `#7ff0c8`. Biom-Töne: Krypta `#4a4560`, Schleimgrotte `#3f5a4a`, Schattenreich `#2e2640`, Glutkammer `#2f2a2a`. |
| Schrift | **Pixelify Sans** (Google Fonts) für Titel, Navigation, Knöpfe, Labels, Zahlen; Versalien-Eyebrows mit 0,08 em Spationierung. Fließtext in einer freundlichen, gut lesbaren Sans (nicht Inter/Roboto). Pixel-Text immer mit 1-px-Schatten `#1c1a2b`. |
| Pixel-Regeln | Sprites und UI-Grafiken nur ganzzahlig skaliert (2×, 3×, 4×), `image-rendering: pixelated`. Grundraster 8 px; bei 3× Skalierung sind 24 px die natürliche Einheit für Abstände und Rahmen. |
| Panels und Knöpfe | 9-Slice aus `art/ui/panel`, `panel_gold` (ausgewählt/hervorgehoben), `panel_dark` (Overlays, Kopfzeile), `button`, `button_hover` (6 px Rand, 3× = 18 px). Fokus: Goldrahmen + Gold-Cursor `>` wie im Hauptmenü. |
| Licht | Radiale Verläufe in Gold/Orange um Laternen, Fackeln, Portale; der Rest bleibt dunkel. Maximal eine große Lichtquelle pro Abschnitt. |
| Bewegung | Sprite-Animationen als CSS `steps()` mit 4–10 fps (Werte aus `art/index.json`). Zwei Arten: **Ambiente** (Laterne, Nebel, Fackel: immer an, leise) und **Belohnung** (Hover öffnet Tür, Boss greift an, Huhn pickt). `prefers-reduced-motion` schaltet alles auf Standbild. |
| Layout | Inhalt max. 1120 px breit, Hero volle Breite. Mobil ab 360 px: Hero zugeschnitten (Eingang mittig, Spieler sichtbar), Karten untereinander, Dorf-Streifen horizontal scrollbar. |
| Bilder | Alles WebP; Pixel-Art verlustfrei, Szenen (Keyart, Biome) verlustbehaftet mit Qualität 85–90. |

## 3. Seitenstruktur

```text
/de  /en
├── Start                  (Hero, Säulen, Run, Biome & Bosse, Dorf, Zusammen, Status)
├── /ranglisten  /leaderboards  (Solo, Gruppe, Gilden · Allzeit, Saison)
├── /gilden/[tag]  /guilds/[tag]
├── /datenschutz  /privacy · /impressum  /imprint   (Texte aus eRecht24 über die API)
└── 404
```

**Kopfzeile:** Logo links (klickbar), Navigation „Spiel · Ranglisten“, rechts Sprachumschalter (DE | EN) und Musikschalter (Pixel-Lautsprecher, standardmäßig aus). Auf der Startseite liegt die Kopfzeile transparent über dem Hero, sonst in `panel_dark`.
**Fußzeile:** Spiel, Ranglisten, Datenschutz, Impressum · Sprache · „© 2026 Soulwick“ · WebBude-Hinweis wie bei DapItUp (nur hier).

## 4. Startseite: Storyboard

| Nr. | Abschnitt | Botschaft (ein Satz) | Elemente | Sprites aus `art/` | Interaktion / Easter Egg |
| --- | --- | --- | --- | --- | --- |
| 1 | **Hero** | „Das letzte Licht im endlosen Dunkel.“ | Nachtszene vor dem Dungeon-Eingang aus dem Hauptmenü (`ui/menu/menu_bg_far` + `menu_bg_near`, ferne Ebene mit leichter Parallaxe), Logo (`brand/logo.webp`, sonst `ui/logo` 3×), Tagline, zwei Knöpfe „Spiel entdecken“ / „Ranglisten“, leise Zeile „Download folgt · Steam · Google Play · App Store“. Mit Keyart (`brand/keyart.webp`) wird die Szene zum Hintergrund, Sprites bleiben davor. | `buildings/lamp_post_4f`, `player/player_idle_4f`, `props/abyss_mist_4f`, Sterne als CSS | Sterne funkeln; Laterne per Klick an/aus; alle ~40 s hüpft ein Schleim unten durchs Bild; 5× Logo klicken → einmal Münzregen (`props/gold_coin_4f`). |
| 2 | **Drei Säulen** | „Endlos tief, jeder Run anders, dein Dorf wächst.“ | Drei `panel`-Karten mit Titel, zwei Zeilen Text, je ein Sprite. | `props/torch_4f`, `weapons/sword\|bow\|staff` + `props/gold_coin_4f`, `props/fountain_4f` | Hover hebt die Karte 2 px, Sprite wechselt von Standbild auf Animation. |
| 3 | **So läuft ein Run** | „Fünf Räume, dann der Miniboss; alle 15 Räume ein Boss.“ | Horizontale Leiste aus fünf Türen: Kampf · Kampf · Kampf + Upgrade · Spezialraum · Miniboss/Boss (Bosstor). Darunter eine Zeile Goldregel: „Portal: 100 % · Tod: 50 %“. | `environment/doors/door_frame_<biom>`, `door_<biom>_open_4f`, `door_frame_boss`, `door_special_symbols` | Hover öffnet die Tür (Frames 1→4) und zeigt die Kurzbeschreibung; auf Mobil tippen. |
| 4 | **Vier Biome, vier Bosse** | „Krypta, Schleimgrotte, Schattenreich, Glutkammer, jedes mit eigenem Boss.“ | Vier Karten im Biom-Ton, Kachelmuster aus `environment/tiles` (10 % Deckkraft) oder `brand/biome_<id>.webp`, Boss-Sprite 64×64 bei 3×, Porträt als Badge, eine Zeile Flavour. | `bosses/<name>_idle_4f`, `_attack_4f`, `_portrait` | Hover: Boss greift an (idle → attack), Karte leuchtet im Biom-Akzent. |
| 5 | **Das Dorf** | „Ein Teil deines Golds bleibt. Baue aus, kehre stärker zurück.“ | Breiter Streifen Wiese und Weg, Gebäude mit Schildern: Schmiede, Handelsposten, Chronik, Gildenhaus; darunter vier Kurzzeilen. | `environment/buildings/*`, `environment/village/*`, `npcs/villager_*_walk_6f`, `npcs/cat_walk_6f`, `npcs/chicken_walk_4f`, `ui/sign_*` | Dorfbewohner und Tiere laufen langsam durch; Huhn bleibt bei Hover stehen und pickt; Katze dreht sich um. |
| 6 | **Zusammen ins Dunkel** | „Koop bis vier, Gilden, Ranglisten, ein Konto auf allen Plattformen – in Planung.“ | Zwei Spalten: links vier Spieler in den Koop-Farben (`player_tint_mask`: `#3690da`, `#e0463a`, `#5fcd62`, `#f2cf4a`) nebeneinander, rechts Plattform-Chips „Steam · Google Play · App Store“ (neutral, Pixel-Icons, Beschriftung „geplant“) und die Crossplay-Zeile. | `player/player_walk_6f` eingefärbt, `ui/icon_host`, `ui/teammate_arrow`, `ui/guild_emblems` | Hover auf einen Spieler: er winkt (idle schneller) und der Teammate-Pfeil zeigt auf ihn. |
| 7 | **Status** | „Soulwick entsteht gerade. Testphase folgt.“ | Kurzer Statustext, Link zu Ranglisten, optional Discord (nur mit Link). | `props/exit_portal_6f` als Trenner | Portal pulsiert leise. |
| 8 | **Fußzeile** | – | Links, Sprache, Musik, Copyright, WebBude-Hinweis. | `ui/logo_square` klein | – |

Reihenfolge und Länge sind bewusst knapp: Hero + sieben Abschnitte, jeder passt auf einen Bildschirm. Mehr erklärt das Spiel selbst.

## 5. Spielseite (`/spiel`): ENTFÄLLT

> Entscheidung Projektmitglied 14.10.2026: Die Website ist ein Teaser, keine Anleitung. Es gibt keine Spielseite, keine Steuerungs-, Waffen- oder Upgrade-Tabellen; die Anker der Landingpage (Spiel, Waffen, Biome, Dorf, Koop & Gilden, Ranglisten) reichen. Der folgende Aufbau bleibt nur als Archiv stehen.

### Ursprünglicher Entwurf (nicht umsetzen)

Links (Desktop) ein klebendes Inhaltsverzeichnis in `panel_dark`, rechts die Abschnitte als Panels. Jeder Abschnitt: Eyebrow in Versalien, Titel, Text, eine Tabelle oder Icon-Reihe, ein Sprite als Illustration.

| Abschnitt | Inhalt | Illustration |
| --- | --- | --- |
| Worum geht es | Dorf → Dungeon → Räume → Boss → Lagerfeuer → tiefer oder zurück. | Spieler mit Laterne |
| Steuerung | Tabelle WASD, Maus, linke Maustaste, Leertaste (Dash), Q, E, Tab, Esc; Hinweis „Controller und Touch: geplant“. | Dash-Staub `effects/dash_dust_4f` |
| Ein Run, Raum für Raum | Fünferzyklus, Spezialräume (Shop, Waffenwahl, Brunnen, Extra-Upgrade, Prüfungsraum), Lagerfeuer nach Bossen, Entscheidung bei Raum 45, Endlosmodus. | Türen-Leiste wie auf der Startseite, hier mit allen Raumarten |
| Waffen | Schwert, Bogen, Magierstab (Richtwerte aus dem PRD), Dolch und Hammer als neuere Waffen; zwei Slots, Wechsel mit Q. | `weapons/*`, `ui/icon_*` |
| Upgrades | Vier Kategorien farbcodiert (Attribut blau, Mechanik grün, Effekt orange, Waffe lila), je drei Beispiele mit Icons, Stack-Logik in einem Satz. | `ui/upgrade_*` |
| Herzen, Schild, Dash | 6 HP = drei Herzen in Vierteln, Schild vor HP, Dash schützt, Heilung alle fünf Räume. | `ui/heart_*`, `ui/shield_icon` |
| Gold und Dorf | 100 % am Portal, 50 % bei Tod; Gebäude Schmiede, Handelsposten, Chronik, Gildenhaus; Seelenkristalle. | `ui/gold_icon`, `ui/crystal_icon`, Gebäude |
| Biome und Bosse | Vier Biome alle 15 Räume, Bossnamen, Elite-Varianten (Badges). | Boss-Porträts, `ui/badge_*` |
| Koop, Gilden, Ranglisten | Geplant: bis vier Spieler, Gilden mit Kasse und Schmiede, Ranglisten Solo/Gruppe/Gilde, Saison je Monat. | Vier eingefärbte Spieler |
| FAQ | Preis, Plattformen, Zeitpunkt, offline spielbar, Spielstand, Koop: ehrliche Kurzantworten. | – |

## 6. Ranglisten und Gildenseiten

- Ranglisten: Tabs als Pixel-Knöpfe (Solo · Gruppe · Gilden), Zeitraum (Allzeit · Saison) mit Monatswahl; Tabelle mit Rang, Name, Raum, Dauer, Datum; Top 3 mit Trophäen-Icon, Gleichstand = gleicher Rang. Leer oder API nicht erreichbar → Hinweisbox in `panel` statt Fehler.
- Gildenseite: Name, Kürzel als Wappen-Badge (`ui/guild_emblems`), Mitgliederzahl, bester Run; später Wappenwahl.

## 7. Rechtsseiten

Impressum und Datenschutz kommen aus eRecht24 über die API (`GET /legal/:type`). Die Seite rendert das HTML in einer ruhigen Lesetypografie (max. 72 Zeichen Zeilenlänge, Überschriften in Pixelify Sans). Fehlt der Text noch, zeigt sie ein Panel „wird gerade eingerichtet“ plus die bekannten Fakten (was das Spiel speichert, keine Tracking-Cookies, Konto löschen im Spiel). Niemals erfundene Namen oder Adressen.

## 8. Easter Eggs: Regeln und Liste

Regeln: nie vor Inhalt, höchstens eines gleichzeitig sichtbar, kein Ton ohne Musikschalter, alles mit `prefers-reduced-motion` aus, kein zusätzliches Skript-Gewicht über ein paar kleine Client-Komponenten hinaus.

1. Schleim hüpft alle ~40 s unten durch den Hero.
2. Laterne im Hero per Klick an/aus (lokaler Zustand).
3. Fünfmal aufs Logo klicken → einmaliger Münzregen.
4. Huhn im Dorf bleibt bei Hover stehen und pickt; Katze dreht sich um.
5. Türen im Run-Abschnitt öffnen sich bei Hover; Bosstor flackert mit Fackeln.
6. Bosse greifen bei Hover an.
7. 404-Seite: Spieler fällt (`death_6f`), bei Hover `revive_4f` und „Zurück ins Dorf“.
8. Später (optional): Konami-Code schaltet die Seite in „Schattenreich“-Töne.

## 9. Sound

Dorf-Thema (`audio/music/village.wav` → OGG + M4A, < 2 MB) als leise Schleife (Lautstärke 0,35, Einblenden), **standardmäßig aus**, Schalter in Kopf- und Fußzeile, Wahl im Browser gemerkt. Optional später: im Biome-Abschnitt sanft zum Krypta-Thema überblenden.

## 10. Mockups

Pixel-Raster 3×, Palette und Schrift aus [../TOKENS.md](../TOKENS.md), Sprites aus `soulwick/art/`, Referenz-Screens in `soulwick/docs/design/screens/` (vor allem `13_hauptmenue.png`, `12_dorf_v2.png`, `11_bosskampf_grotte.png`). Ablage: dieser Ordner (`docs/design/web/`), PNG oder WebP, Dateiname `<seite>_<gerät>_<sprache>[_ausschnitt]`.

**Geliefert** (14.10.2026, Claude Design, zusammen mit [HANDOFF_WEB.md](HANDOFF_WEB.md)):

| Datei | Größe | Was es zeigt |
| --- | --- | --- |
| `landing_desktop_de.png` | 1280 × 5706 | Startseite Desktop, Deutsch, ganze Seite (ersetzt M1) |
| `landing_desktop_en.png` | 1280 × 5615 | Startseite Desktop, Englisch, ganze Seite |
| `landing_mobile_de.png` | 390 × 10349 | Startseite Mobil, Deutsch, ganze Seite (ersetzt M2) |
| `landing_desktop_de_hero.png` | 1280 × 760 | Hero-Ausschnitt Desktop mit Keyart im Pixelrahmen (deckt M3 ab; Hover-Zustände im Prototyp `Soulwick-Landing.dc.html`) |
| `landing_mobile_de_top.png` | 390 × 900 | oberer Ausschnitt Mobil (Navbar, Hero) |

Die Abschnittsfolge der gelieferten Landingpage weicht vom Storyboard in §4 ab (Navbar, Hero, Kern-Loop, Waffen & Upgrades, Biome, Dorf, Koop & Gilden, Ranglisten-Teaser, Footer); verbindlich ist [HANDOFF_WEB.md](HANDOFF_WEB.md) §3. Die Kopfzeile der Startseite ist damit ebenfalls geliefert (früher M9, Zustand „Startseite“).

**Noch gewünscht** (Reihenfolge = Priorität; Dateinamen nach dem Muster der gelieferten Dateien):

| Nr. | Mockup | Datei (Vorschlag) | Format | Was es zeigen soll |
| --- | --- | --- | --- | --- |
| M4 | Spielseite Desktop | `game_desktop_de.png` | 1280 × (ganze Seite) | Inhaltsverzeichnis links, Abschnitte aus §5, Tabelle Steuerung, Upgrade-Reihe |
| M5 | Spielseite Mobil | `game_mobile_de.png` | 390 × (Ausschnitt) | Inhaltsverzeichnis als aufklappbare Leiste, zwei Abschnitte |
| M6 | Ranglisten | `leaderboards_desktop_de.png` | 1280 × 900 | Tabs, Zeitraumwahl, Tabelle mit Top 3, Hinweisbox-Variante |
| M7 | Rechtsseite | `legal_desktop_de.png` | 1280 × 900 | Lesetypografie über eRecht24-HTML, Platzhalter-Variante |
| M8 | 404 | `notfound_desktop_de.png` | 1280 × 900 | Gefallener Spieler, Hover-Zustand, Knopf „Zurück ins Dorf“ |
| M9 | Kopf- und Fußzeile auf Unterseiten | `header_footer_desktop_de.png` | 1280 × 200 | Zustände: Unterseite (`panel_dark`), Musik an/aus, Sprache |

Die Website-Agenten lesen die Mockups als Vorlage; Abweichungen begründen sie im Bericht. Mockups legen **nicht** fest: exakte Texte (kommen aus `messages/{de,en}`), Store-Badges (erst mit Links), Preise und Termine.

## 11. Grafiken, die noch fehlen

Siehe `soulwick/docs/SPRITES_V5.md` §8: `logo.webp` 512×128, `logo_square.webp` 256×256, `keyart.webp` 1920×1080, `og_image.webp` 1200×630, `biome_*.webp` 640×360, `hero_player_lantern.webp` 256×256, `platform_pc|mobile|crossplay.webp` 32×32. Wünsche der Umsetzungs-Agenten werden dort ergänzt, sobald ihre Berichte vorliegen.

## 12. Offene Fragen an das Projektmitglied

1. Keyart gemalt (Illustration) oder aus Sprites komponiert wie bisher? Beides funktioniert im Hero; gemalt wirkt im Store stärker.
2. ~~Hochschule nennen?~~ Entschieden 14.10.2026: keine Hochschule; im Footer nur „Made with ♥ by WebBude“, sonst kein WebBude-Hinweis.
3. Discord-Server für die Testphase: ja oder noch nicht?
4. Trailer: Platz im Hero (Play-Knopf über der Szene) vorsehen oder erst mit Testphase?
