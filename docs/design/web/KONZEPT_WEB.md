# Website-Konzept Soulwick (playsoulwick.com)

> **Stand:** 17.10.2026 · **Zweck:** Absicht und Offenes der Website (D-178: Was gebaut ist, steht im Code unter `apps/web`, nicht hier).
> **Grundlage:** Positionierung, Ton, Maskottchen, Modell und Reihenfolge aus `soulwick/docs/DECISIONS.md` **D-173 bis D-179** und `soulwick/docs/PRODUKT.md`. Diese Fassung ersetzt das Konzept vom 14.10.2026 („Das letzte Licht im endlosen Dunkel“, Feature-Liste); die Git-Historie hat die alte Fassung.
> **Dazu:** [HANDOFF_WEB.md](HANDOFF_WEB.md) (Layout und Pixel-Komponenten als Inspiration; Positionierung und Tagline dort überholt), [../TOKENS.md](../TOKENS.md) (Farben, Schriften, Komponenten), [BRIEFING_WEB.md](BRIEFING_WEB.md) (fehlende Grafiken).

## 1. Wofür die Website da ist

- **Lust machen, nicht erklären.** Wer die Startseite öffnet, weiß nach einer Minute: Pixel-Roguelite, mit Freunden, kostenlos im Browser, ständig passiert etwas Lustiges. Danach ein Knopf: „Kostenlos im Browser spielen“, solange die Live-Funktionen an sind, sonst das Schild „Zum Release spielbar“ mit „Was dich erwartet“ (und „Auf die Steam-Wunschliste“, sobald es die Steam-Seite gibt).
- **Release-Stand, auch vor dem Release** (Projektmitglied 17.10.2026: „bau alles schon ready aus, auch wenn es noch nicht da ist … zum Release ist ja dann alles da“): Die Website beschreibt Soulwick so, wie es zum Release ist. Koop mit Freunden, „Wünsch dir einen Boss“, Wick als dein Begleiter, Outfits (nur Aussehen), Dorf ausbauen und verschönern, Freunde ins Dorf einladen, Gilden und Ranglisten stehen als Teil des Spiels da: keine Chips oder Wörter wie „kommt“, „in Arbeit“, „geplant“ oder „zieht gerade ein“. „Was kommt“ zeigt nur, was nach dem Release kommt (Party-Modus, mehr Inhalte), ohne Termine. **Zum Release ist Soulwick auf allen Plattformen spielbar:** Browser, Steam, Android und iOS (Projektmitglied 17.10.2026: „Zum Release ist auf allen Versionen das spielbar“; ersetzt „Android/iOS später“). `apps/web/test/release-copy.test.ts` prüft Texte und Neuigkeiten auf Teaser-Wörter.
- **`LIVE_FEATURES` schaltet nur Live-Funktionen** (Projektmitglied 17.10.2026: nur die Live-Features ausschalten, App installieren und Spielen gehen erst zum Release): Spielen und Installieren (dazu `GAME_URL`), die Live-Tafeln auf der Startseite, `/leaderboards`, `/guilds/<kürzel>` und die Spiel-Downloads auf der Open-Source-Seite. Production läuft bis zum Release mit `false`: statt Spielen-Knopf das Schild „Zum Release spielbar“, statt Tafeln „Die Tafeln gehen zum Release live“, keine toten Links, keine 404 aus der Navigation. Jede Feature-Beschreibung ist in beiden Modi gleich.
- **Für Freundesgruppen von 12 bis 25** (D-173). Sprache wie unter Freunden, nicht wie ein Handbuch; nicht an Kinder vermarkten.
- **Die Seite lebt.** Neuigkeiten (Devlog), Ranglisten und „Was kommt“ zeigen, dass sich Soulwick bewegt. Ein Besuch nach zwei Wochen soll etwas Neues zeigen.
- **Ehrlich.** Was nach dem Release kommt, heißt „später“ bzw. „danach“. Keine Preise, keine Termine. Jeder Plattform-Stand ergibt sich nur aus `LIVE_FEATURES`, `GAME_URL` und `content/stores.json`, nichts ist fest als „zum Release“ eingetragen, damit nach dem Release nichts veraltet.
- **Store-Knöpfe (Orchestrator 17.10.2026 nach den Marken-Regeln von Apple, Google und Valve):** vor dem Release eigene Pixel-Kacheln ohne fremde Logos oder Badges („Browser“, „PC · Steam“, „Android“, „iPhone & iPad“, jeweils „zum Release“); erst mit Store-Adresse in `apps/web/content/stores.json` und `LIVE_FEATURES` das offizielle Badge des Stores unverändert als Link in unserem Pixel-Rahmen (App Store zuerst, Google Play mindestens gleich groß, Markenhinweis darunter). Badge-Dateien: `apps/web/public/brand/README.md`. Wunsch-Boss-Beispiele sind erfunden, nie echte Personen (D-179 OFFEN).
- **Social-Links aus einer Datei:** `apps/web/content/social.json` (Discord, TikTok, YouTube, Instagram, X, Reddit). Es erscheinen nur Kanäle mit Adresse: Spalte „Community“ im Footer, Reihe „Folg Soulwick“ unter den Neuigkeiten. Die Steam-Seite steht in `content/stores.json` und ist vor dem Release der Wunschlisten-Knopf in Hero und Kopfzeile. Leer = nichts Soziales auf der Seite. Pflege und Deploy: `apps/web/README.md`. Ein Admin-Panel dafür erst, wenn sich die Links oft ändern.
- **Mauszeiger aus dem Spiel:** überall der Pixel-Pfeil aus den Spielmenüs, auch auf Links und Knöpfen (keine runde System-Hand), im Dungeon des Hero das Fadenkreuz aus dem Kampf. Die Dateien kommen 1:1 aus dem Spiel (`apps/web/scripts/sync-cursor.ts`), je Bildschirmdichte mit ganzen Pixeln, nie unscharf hochskaliert.
- **Spielfiguren aus dem Spiel:** Hero, Läufer-Leiste und Koop-Lobby zeigen die vier echten Spielfiguren (Standardfigur, Ember, Moss, Frost aus `soulwick/art/characters/`, per `apps/web/scripts/sync-sprites.ts`), keine eingefärbten Kopien einer Figur, und ohne Namen: Die Standardfigur heißt im Spiel noch „Wick“ wie das Maskottchen (§6).
- **Dorfbild aus dem Spiel:** „Dein Dorf“ zeigt das aktuelle Dorf bei Tag als Bildschirmfoto aus einem leisen Spiellauf (`apps/web/scripts/sync-village.ts`), keine gemalte Ersatz-Illustration. Nach größeren Dorf-Änderungen im Spiel neu aufnehmen.
- **Kein Handbuch.** Keine Werte, keine Tabellen, keine Technik-, Engine- oder Server-Begriffe.

## 2. Ton und Aufmachung (D-174)

- **Kernsatz:** „Das Pixel-Roguelite, in das du mit Freunden reinrennst – jeder Run anders, jeder Boss ein Clip.“ **Tagline:** „Schnapp dir deine Freunde. Bring Licht ins Dunkel.“ / „Grab your friends. Light the dark.“
- **Licht ist das Motiv.** Dunkle Abschnitte (Dungeon) dürfen düster sein, haben aber immer genau eine warme Lichtquelle. Das Dorf ist der einzige Abschnitt bei Tag: hell, süß, gemütlich.
- **Moderne Pixel-Art statt Retro:** weiches Licht, Glow, Partikel, sanfte Übergänge, Squash and Stretch. Nach außen „moderne Pixel-Art“, nie „8-Bit“.
- **Bewegung antwortet dem Besucher** (Wick folgt der Maus, Figuren hüpfen beim Antippen) statt überall von selbst zu zappeln. `prefers-reduced-motion` hält alles an; keine schweren Bibliotheken, Bilder als WebP.
- **Status über Licht, nur für Verfügbarkeit:** grünes Licht = jetzt spielbar, warmes Licht = zum Release, ruhiges Licht = später (Plattform-Kacheln im Hero). Features bekommen keine Status-Chips. Unter „Was kommt“ brennt die Fackel dessen, was als Nächstes kommt.
- **Maskottchen:** Wick (kleines Docht-Wesen: eine lebende Kerze mit Flamme, D-175) und das Huhn tauchen immer wieder auf, auch als kleine Easter Eggs.

## 3. Erzählung der Startseite

Reihenfolge = Wichtigkeit. Jeder Abschnitt hat eine Botschaft.

| Abschnitt | Botschaft |
| --- | --- |
| Hero | Schnapp dir deine Freunde, bring Licht ins Dunkel. Kostenlos im Browser (vor dem Release: „Zum Release spielbar“). |
| Mit Freunden reinrennen | Raum auf, Link oder Code schicken, zu viert rein; Koop ist der Kern. |
| Wünsch dir einen Boss | Boss besiegt, am Lagerfeuer einen Albtraum-Boss wünschen, ein paar Räume später steht er da; nur erfundene Beispiele. |
| Triff Wick | Das ist Wick, dein Begleiter, und das Huhn ist nie weit; Outfits nur fürs Aussehen. |
| Kein Abstieg ist wie der andere | Biome, Bosse, Minispiele; leicht zu lernen, schwer zu meistern. |
| Dein Dorf | Der gemütliche Gegenpol, Bild aus dem Spiel: ausbauen, verschönern, Freunde einladen. |
| Wer kommt am tiefsten? | Gilden und drei Tafeln; die Live-Tafeln nur mit `LIVE_FEATURES`, sonst „gehen zum Release live“. |
| Was kommt | Nur nach dem Release: Party-Modus, mehr von allem. Plattformen stehen hier nicht, sie sind alle zum Release da. |
| Aus der Werkstatt | Die neuesten Beiträge und die Social-Kanäle, die es gibt. |
| Fragen und Antworten | Kosten, Mitspieler, Geräte, Kinder, Konto, Termin: kurz und ehrlich; die Termin-Frage wird mit `LIVE_FEATURES` zu „Wo bekomme ich Soulwick?“. |
| Open Source | Code offen, Grafik, Musik, Name und Figuren geschützt (D-177). |

## 4. Seiten

`/` (Startseite), `/news` und `/news/<slug>` (Neuigkeiten), `/leaderboards`, `/guilds/<kürzel>`, `/open-source`, `/privacy`, `/imprint`, `/delete-account`, 404. Englische Pfade für beide Sprachen, die Sprache steht nie in der URL (P-012). Rechtstexte kommen aus eRecht24, nie erfundene Angaben.

## 5. Neuigkeiten

- **Statisch:** nicht jeden Tag neue Beiträge (Projektmitglied 17.10.2026), sondern einer je spürbarem Schritt; `/news` und die Beiträge werden beim Build je Sprache vorab erzeugt.
- Ein Beitrag je spürbarem Schritt (Koop-Test, Wick im Spiel, neuer Boss, Party-Modus …), kurz, in Spielersprache, immer Englisch und Deutsch. Ablauf und Format: `apps/web/content/news/README.md`.
- Ideen, nicht entschieden: RSS-Feed, „Benachrichtige mich“ per E-Mail (braucht Datenschutztext und Double-Opt-in), Clips aus der Community.

## 6. Offene Fragen an das Projektmitglied

1. **Social-Kanäle:** Die Datei `apps/web/content/social.json` steht bereit (alle Adressen leer). Welche Kanäle gibt es, und wer trägt sie ein? Bluesky fehlt bisher in der Liste.
2. **Clip oder Trailer im Hero** (WebM, ohne Ton beim Start): ab wann?
3. **Wick:** endgültiger Name und Aussehen (D-175 OFFEN); bis zur Grafik zeigt die Seite eine Kerze, die etwas höher als breit ist, als Platzhalter. Achtung: Im Spiel heißt die bisherige Spielerfigur intern `wick` (`docs/design/sprites/SPRITES_V10.md` §7a); das kollidiert mit dem Maskottchen.
4. **Live schalten zum Release:** `LIVE_FEATURES=true` und `GAME_URL` in production setzen, sobald Soulwick erscheint; dann zeigt die Seite Spielen, Installieren und die Live-Tafeln.
5. **Steam-Wunschliste:** Sobald es eine Steam-Seite gibt, ihre Adresse bei `steam` in `content/stores.json` eintragen; dann erscheint der Knopf „Auf die Steam-Wunschliste“. Ob das schon zur öffentlichen Phase zählt, ist D-179 OFFEN.
6. **Presse und Creator:** eigene Seite mit Logos, Clips und Infos für Streamer?
7. **Keyart:** Die bisherige Keyart trägt den Schriftzug und zeigt eine Figur allein; der neue Hero baut die Szene aus Spiel-Sprites. Neu malen lassen (Freunde und Wick, ohne Schriftzug) für Stores und Social?
8. **Store-Badges:** App-Store-Badge (SVG von Apple) und optional das Steam-Logo von Valve fehlen noch als Datei (`apps/web/public/brand/README.md`); das Google-Play-Badge liegt bereit.
9. **Social-Symbole:** Die Pixel-Symbole für Discord, TikTok, YouTube, Instagram, X und Reddit im Footer sind nachgezeichnete Marken-Logos. Viele dieser Marken erlauben nur ihre Original-Logos; vor dem ersten echten Link klären, ob neutrale Symbole oder die Original-Dateien besser sind.

## 7. Mockups

Mockups sind Inspiration, kein Bauplan (`soulwick/AGENTS.md` §3). Referenz-Screens des Spiels: `soulwick/docs/design/mockups/screens/` (Hintergründe in `mockups/backgrounds/`). Ablage für Website-Mockups: dieser Ordner, Dateiname `<seite>_<gerät>_<sprache>[_ausschnitt].png`. Die gelieferten `landing_*`-Mockups zeigen noch die alte Positionierung.

**Noch gewünscht:** `news_desktop_de.png` (Übersicht und Beitrag), `leaderboards_desktop_de.png`, `legal_desktop_de.png`, `notfound_desktop_de.png`, und eine Startseite in der neuen Erzählung (`landing_v2_desktop_de.png`, `landing_v2_mobile_de.png`), sobald es Wick-Entwürfe gibt.
