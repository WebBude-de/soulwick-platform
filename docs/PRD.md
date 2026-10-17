# PRD – Soulwick Platform

> **Stand:** 15.10.2026 · **Gilt für:** dieses Repo (Website, Spieler-API, Relay, Admin-Panel).
> Produkt, Pitch und Begriffe: [`../soulwick/docs/PRODUKT.md`](../../soulwick/docs/PRODUKT.md); Spielregeln:
> [`../soulwick/docs/PRD.md`](../../soulwick/docs/PRD.md). **Produkt-Entscheidungen** (D-Nummern) stehen nur
> im Spiel-Repo [`docs/DECISIONS.md`](../../soulwick/docs/DECISIONS.md); bei Widerspruch gilt das Spiel-Repo.
> Technische Entscheidungen dieses Repos: [DECISIONS.md](DECISIONS.md) (P-Nummern).

## 1. Zweck

Das Spiel läuft komplett ohne Server. Die Plattform ergänzt nur, was einen Server braucht:

- **Konten** über Plattform-Identitäten (Gast je Gerät, Steam, Google Play, später Game Center), damit
  ein Spieler auf mehreren Geräten und Stores derselbe ist (D-121, D-122).
- **Koop über das Internet**: ein eigener Relay mit Raumcodes, der Spielpakete nur weiterleitet (D-119).
- **Gilden** mit Gildenkasse und Gilden-Schmiede (D-080, D-081).
- **Run-Berichte und Ranglisten** (D-082).
- eine **Website**, die das Spiel vorstellt und Ranglisten zeigt (aktueller Fokus).
- ein **Admin-Panel** zum Moderieren.
- **Rechtstexte** (Impressum, Datenschutz) aus eRecht24 für Website und später das Spiel.

## 2. Für wen

| Wer | Was |
| --- | --- |
| Spieler (über das Spiel) | anmelden, Koop-Raum erstellen oder beitreten, Gilde gründen/beitreten/verlassen, Gilden-Fortschritt lesen/schreiben, Run melden, Ranglisten sehen, Konto verknüpfen oder löschen |
| Besucher (Website, Englisch oder Deutsch) | Spiel kennenlernen, Plattformen sehen, Ranglisten und Gildenseiten ansehen, Rechtstexte lesen, eigenes Konto mit Löschcode aus dem Spiel löschen |
| Moderator | Spieler sperren/entsperren, Notizen, Runs markieren, umbenennen, Mitglieder entfernen, Live-Räume ansehen und schließen |
| Admin | alles; zusätzlich Gilden auflösen, Runs löschen, Konten löschen, Admin-Konten verwalten |
| Betreiber (Projektmitglied) | zwei Umgebungen `development` und `production` auf dem eigenen VPS mit Dokploy betreiben |

## 3. Anforderungen

### 3.1 Anmeldung und Konten (D-083, D-121, D-122, P-027, P-028)

- **Gast je Gerät** `POST /auth/device`: zufällige Geräte-ID je Installation, ohne Schlüssel; der Weg für
  Test-Builds und Spieler ohne Steam/Google. Ohne Verknüpfung geht das Gastkonto mit dem Gerät verloren.
- **Steam** `POST /auth/steam` und **Google Play** `POST /auth/google-play` (serverseitig geprüft);
  **Game Center** später mit iOS. `POST /auth/dev` nur mit Test-Schlüssel für Werkzeuge und Tests.
- Alle Wege liefern dieselbe Antwort (Session-Token); für den Relay holt das Spiel ein kurzlebiges JWT.
- **Konten verknüpfen** per Verknüpfungscode (wie Among Us); zwei Konten mit Fortschritt werden nur nach
  Bestätigung zusammengeführt (D-122).
- **Konto löschen** im Spiel (`DELETE /me`) und auf der Website mit Einmal-Löschcode, vollautomatisch
  (Google-Pflicht, P-026).
- Gesperrte Spieler bekommen bei jedem Aufruf „gesperrt“ mit Grund und Ende.

### 3.2 Gilden (D-080, D-081)

- Gründen (Name, Kürzel), Beitritt per Einladungscode, jederzeit verlassen. Bis zu 5 Gilden je
  Spieler, höchstens 30 Mitglieder (TESTWERTE, D-147, P-031). Gründer und Offiziere entfernen Mitglieder und
  erneuern den Code; der Gründer ernennt Offiziere.
- **Gilden-Fortschritt** (Vorschlag D-081): Gildenkasse und Schmiede-Stufen auf dem Server; gleichzeitige
  Käufe über eine Versionsnummer abgesichert (kein doppeltes Abbuchen). Gilden-Runs nur mit Mitgliedern.

### 3.3 Run-Berichte und Ranglisten (D-082)

- Der Host meldet am Run-Ende: Modus (`solo`, `quick`, `guild`), Teilnehmer, erreichter Raum, Dauer,
  Seed, Spielversion.
- Plausibilitätsprüfung (Mindestzeit je Raum, bekannte Spielversion). Verdächtige Runs werden
  **markiert, nicht gelöscht**.
- Ranglisten **Spieler Solo**, **Spieler Gruppe**, **Gilden**, jeweils **Allzeit** und **Saison**
  (Kalendermonat). Wertung: höchster Raum, bei Gleichstand kürzere Zeit. Markierte Runs und gesperrte
  Spieler zählen nicht. Ranglisten der Testphase werden zum Steam-Start zurückgesetzt; ob je Plattform
  getrennt oder gemeinsam, ist OFFEN (CP0).

### 3.4 Website (D-093, D-108, P-012, P-015)

- **Zweisprachig**: Englisch als Hauptsprache, Deutsch als zweite; englische Pfade für alle (`/`,
  `/leaderboards`, `/guilds/<kürzel>`, `/imprint`, `/privacy`, `/delete-account`), Sprache aus Cookie
  oder Browsersprache.
- **Landingpage (verspielt)** nach [design/web/HANDOFF_WEB.md](design/web/HANDOFF_WEB.md): Keyart,
  animierte Spiel-Sprites, Biome, Dorf, Koop und Gilden („geplant“), Ranglisten-Teaser.
- **Plattformen** Steam, Google Play, App Store als „geplant“ mit Hinweis auf Crossplay; keine
  Store-Badges, bis es echte Store-Links gibt.
- **Ranglisten** und **öffentliche Gildenseiten**.
- **Konto löschen** ohne Anmeldung: Spielername + Einmal-Löschcode aus dem Spiel, Bestätigungsschritt,
  danach sofortige Löschung; für Spieler ohne Zugang zum Spiel die Support-Adresse.
- **Rechtstexte** aus eRecht24 über die API; solange kein Text vorliegt, ein deutlicher Platzhalter.
- **Graceful Degradation:** Ist die API nicht erreichbar oder fehlt eine Grafik, zeigt die Website eine
  freundliche Meldung bzw. einen Platzhalter; der Build braucht weder API noch eRecht24.

### 3.5 Admin-Panel (D-093, MP7b)

- Anmeldung nur für Admin-Konten; kein Zugriff aus dem Spiel. Zusätzlich abgesichert (Basic Auth,
  IP-Liste oder VPN).
- **Spieler:** suchen, Details (Sperren, Gilde, Runs, Identitäten, Notizen), sperren mit Grund und Dauer,
  entsperren, umbenennen, Konto löschen (nur `admin`).
- **Gilden:** suchen, Details, umbenennen, Mitglied entfernen, Leitung übertragen, Code zurücksetzen,
  auflösen.
- **Runs:** prüfen, markieren/freigeben, löschen. **Live-Räume:** laufende Relay-Räume ansehen,
  schließen, Spieler entfernen.
- **Übersicht und Statistik:** Kennzahlen nur als Zahlen aus vorhandenen Tabellen (P-023).
- **Protokoll:** jede Admin-Aktion mit Admin, Ziel und Zeitpunkt. **Löschprotokoll:** nur Zeitpunkt,
  Weg und „war gesperrt“, keine Namen (P-026).
- **Admins:** anlegen, deaktivieren (nur `admin`).

### 3.6 Datenschutz und Betrieb

- Gespeichert werden nur **Plattform-Identitäten** (nur die Nutzer-ID des Providers), Name, Gilde,
  Run-Berichte. Bei neuen Datenkategorien wird die Datenschutzerklärung in eRecht24 ergänzt.
- Betrieb auf dem eigenen VPS mit Dokploy, zwei Umgebungen mit je eigener Datenbank, eigenen Geheimnissen
  und eigenem Relay; HTTPS; tägliches Datenbank-Backup in `production`
  ([../infra/DOKPLOY.md](../infra/DOKPLOY.md)).
- Spiel-Builds wählen die Umgebung beim Export; die Relay-Adresse meldet die API (`GET /public/config`).

### 3.7 Später

- **KI-Wunschbosse „Traumweber“** (Spiel-Repo `docs/KONZEPT_KI_BOSS.md`): Erzeugung und Moderation auf
  dem Server. Noch OFFEN.
- Discord-Benachrichtigung bei gemeldeten Runs.

### 3.8 Koop-Relay und Crossplay (D-108, D-119, P-016)

- Räume mit 6-stelligem Raumcode, höchstens 4 Spieler (D-084), Host = Peer 1; Beitritt nur mit gleicher
  Spiel- und Protokollversion; mehrere Runs je Raum mit Rückkehr ins Dorf.
- Der Relay prüft das Spieler-JWT und bei Gildenräumen die Mitgliedschaft über die API, leitet Pakete
  weiter, ohne sie zu lesen, und protokolliert keine Inhalte.
- Je Umgebung ein eigener Relay (`play-dev.playsoulwick.com`, `play.playsoulwick.com`).

Zielbild Crossplay über Steam, Google Play und App Store (D-108), Architektur entschieden (D-119):
Host-Modell plus eigener Relay, Reihenfolge Steam → Android → iOS, Publisher WebBude. Konzept für
Entwickler: [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md); Spiel-Pakete:
[`../soulwick/docs/ROADMAP_CROSSPLAY.md`](../../soulwick/docs/ROADMAP_CROSSPLAY.md); Plattform-Pakete:
[ROADMAP.md](ROADMAP.md) P13–P20. Geschäftsmodell als Arbeitsentscheidung: Browser und Handy kostenlos, Steam mit kleinem Preis, verkauft werden nur
Kosmetik und „Werbefrei“ (D-176, Preise OFFEN); Store-Zielgruppe ab 13 (D-173); Touch-Steuerung D-168. Noch OFFEN:
Relay-Regionen, Ranglisten je Plattform (CP0 Frage 7); Stand in [KONZEPT_ONLINE.md](KONZEPT_ONLINE.md) §0 und §8.

## 4. Bewusst nicht

- **Keine Spiellogik auf dem Server.** Koop läuft im Host-Modell (ein Spieler rechnet); der Relay liest
  keine Pakete (D-080, D-083, D-119). Ein dedizierter Godot-Server ist erst später vorgesehen.
- **Keine Pflicht zum Online-Spiel.** Jeder Aufruf aus dem Spiel ist optional und darf scheitern.
- **Keine E-Mail-Konten für Spieler, keine Zahlungsdaten** (bis CP6 anders entschieden wird).
- **Keine Spielanleitung auf der Website**: Die Website ist ein Teaser (Entscheidung Projektmitglied
  14.10.2026); keine Steuerungs-, Waffen- oder Upgrade-Tabellen.
- **Kein Matchmaking**, keine öffentlichen Raumlisten: Freunde teilen einen Raumcode.
- Kein Cloud-Save (CP5) und keine Käufe (CP6) vor ihrem Paket; Käufe nur Kosmetik und „Werbefrei“, keine Lootboxen,
  kein Pay-to-win, serverseitig geprüft (D-176, D-177).

## 5. Abnahme

Die Kriterien stehen je Paket in [ROADMAP.md](ROADMAP.md) („Fertig, wenn“). Prüfbefehle:
[TECHSTACK.md](TECHSTACK.md) §4 bzw. [README.md](../README.md).
