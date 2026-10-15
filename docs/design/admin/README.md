# Admin-Panel – Design (Platzhalter)

> **Stand:** 15.10.2026 · **Status:** noch keine Mockups und kein Handoff. Das Admin-Panel (`apps/admin`) ist seit dem Paket „Admin Design v2“ (15.10.2026) auf die Tokens aus [../TOKENS.md](../TOKENS.md) umgestellt (siehe unten).

## Was hier kommen wird

- `HANDOFF_ADMIN.md` aus Claude Design (verbindlich für Layout und Komponenten) und Mockups als PNG/WebP, benannt wie unter `../web/` (`<seite>_<gerät>_<sprache>.png`, z. B. `players_desktop_de.png`).
- Umfang laut `../../PRD.md` §3.5 (Stand P15/P18/P19): Anmeldung, Übersicht (Kennzahlen, Tagesreihe), Statistik, Spieler (Suche, Details, sperren/entsperren, umbenennen, Notizen, Konto löschen), Gilden (Statusfilter, Leitung übertragen, Notizen der Mitglieder), Runs (prüfen, markieren, löschen), Live-Räume (Relay: schließen, entfernen), Löschprotokoll (nur lesen, P-026), Protokoll (Filter Zeitraum, Bereich, Aktion, Ziel), Admins. Rechtstexte haben keine Admin-Funktionen: Die API ruft sie nur bei eRecht24 ab (Schlüssel in der Umgebung, Speicher-Cache).

## Regeln

- Dieselben Tokens wie die Website: [../TOKENS.md](../TOKENS.md) §1–§5, Anwendung für das Panel in §6: ruhig, dichte Tabellen und Formulare, keine Easter Eggs, keine Sprite-Animationen.
- Texte Deutsch (`AGENTS.md` Regel 8), Desktop zuerst (Moderation am Rechner), trotzdem ab 360 px bedienbar.
- Destruktive Aktionen immer mit Bestätigung und Grund (Protokollpflicht, `AGENTS.md` Regel 5).

Bis Mockups vorliegen, baut `admin-dev` nach TOKENS.md und begründet Abweichungen im Bericht.

## Umgesetzt (Admin Design v2, 15.10.2026)

- Tokens §1 als Tailwind-4-`@theme` in `apps/admin/src/app/globals.css`; Pixelify Sans lokal (`next/font/local`), DM Sans über `next/font/google`; Favicon, Apple-Touch-Icon und Logo (`logo.webp`, 160×48) aus dem Web-Paket nach `apps/admin/public/brand/` kopiert.
- Seitenleiste mit Logo, „Admin-Bereich“ als Eyebrow, Pixel-Icons (16 px) und markiertem aktivem Punkt (Goldbalken); ab 360 px wird sie zur Kopfzeile mit waagerecht scrollender Navigation.
- Komponenten: Karte, Primär-/Sekundär-/Gefahr-Button, Status-Chips (aktiv `--mech`, gesperrt `--danger`, gemeldet `--effect`, offen `--muted`), Tabellen (14 px DM Sans, Zebra `--bg-deep`, Eyebrow-Spaltenköpfe), Meldungen (Erfolg/Hinweis/Fehler), Trenner `divider.webp`, Gold-Fokus auf allem Interaktiven.
- Einheitliche Bestätigung für destruktive Aktionen (`components/danger-action.tsx`), Übersicht als Dashboard, Seiten „Statistik“, „Live-Räume“ und „Löschprotokoll“ (nur lesen, ohne Namen; P-026).
- Abschluss 15.10.2026 (P15, P18, P19): Übersicht mit kompakten Kacheln (6 je Zeile ab 1280 px, Warnchip neben der Zahl) und Tagesreihe der letzten 14 Tage als drei kleine Inline-SVG-Säulendiagramme; Live-Räume als eine dichte Tabelle (Raum zuerst, Aktionen zuletzt, Spieler mit „Entfernen…“ in der Zeile); Gildenseite mit Notizen-Spalte und „Notizen zu Mitgliedern“; Anmelde-Hinweise „abgelaufen“ und „abgemeldet“; ruhige Fehlerseite, wenn die API nicht antwortet. Die Seite „Rechtstexte“ ist entfallen (P-025), „Löschanträge“ ist zum „Löschprotokoll“ geworden (P-026, alter Pfad leitet um).

**Abweichungen von TOKENS.md (bitte bei der Übergabe prüfen):**

1. Zahlen/Kennungen in Pixelify 400 laufen mit 1,15 em (in Tabellen also ca. 16 px statt 14 px): Bei 14 px verschwimmen in Pixelify die Ziffern 2, 5 und 8.
2. Buttons heben/senken sich nicht beim Überfahren (nur Farbwechsel), das Eindrücken passiert nur beim Klicken (`:active`); Höhe 40 px, in Tabellen 32 px (Web 44 px), weil Tabellen dicht bleiben sollen.
3. H1 im Panel 28–32 px statt `clamp(38px, 5vw, 60px)`; Kartentitel 20 px.
4. Löschprotokoll (P-026, ersetzt die Löschanträge): Kanäle sind keine Status und stehen deshalb als neutrale Chips (`--muted`); die Kanal-Zähler sind Chips als Filter-Links, der gewählte mit Goldrand (wie der goldene Filter-Button). Nur „war gesperrt“ nutzt `--danger`.
5. Diagramme (Statistik, Übersicht) in `--attr` als einzige Datenfarbe, eine Reihe je Diagramm (kleine Mehrfachdiagramme statt zweiter Datenfarbe); Status-Farben bleiben Status vorbehalten. Statistik als HTML/CSS-Säulen mit Achse, Übersicht als Inline-SVG ohne Achse (Summe bzw. „verschiedene“ Spieler im Titel, Tageswert als Hover-Text).
