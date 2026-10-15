# Soulwick Admin-Bereich (`@soulwick/admin`)

## Zweck

Verwaltungsoberfläche für Admins und Moderatoren:

- **Übersicht:** Kacheln „Moderation“ (Spieler, aktive Sperren, Gilden, gemeldete Runs mit
  Warnrahmen, wenn etwas zu prüfen ist; Löschungen der letzten 7 Tage ohne Warnzustand) und
  „Aktivität“ (nur, wenn die API die Felder liefert), Tagesreihe der letzten 14 Tage (Runs, aktive
  und neue Spieler aus `/admin/stats/daily`, kleine Säulendiagramme als Inline-SVG), dazu
  „zuletzt“-Listen (gemeldete Runs, letzte Löschungen, Protokoll)
- **Statistik:** Tageswerte für 7, 30 oder 90 Tage (Runs, aktive und neue Spieler), erreichter Raum,
  Durchschnitte; Diagramme als schlichtes HTML/CSS, Werte zusätzlich als Tabelle
- **Spieler:** Suche (Name, ID, Steam-ID), Details, Sperren mit Grund und Dauer (1 Tag, 7 Tage,
  30 Tage, dauerhaft), Entsperren, Umbenennen, Moderations-Notizen, Konto löschen (nur Rolle Admin,
  Bestätigung durch Eingabe des Namens, optionale Notiz fürs Protokoll; für Spieler ohne Zugang zum
  Spiel)
- **Gilden:** Suche mit Statusfilter (aktiv, aufgelöst, alle), Details, Mitglied entfernen,
  Gildenleitung übertragen (mit Grund), Umbenennen, Einladungscode zurücksetzen, Auflösen
  (Bestätigung durch Eingabe des Kürzels); Notizen-Zahl je Mitglied und die letzten Notizen der
  Mitglieder (nur lesen, Notizen hängen an Spielern)
- **Runs:** gemeldete Runs prüfen, markieren (mit Grund)/freigeben, löschen
- **Live-Räume:** offene Koop-Räume auf dem Relay als Tabelle (Code, Modus, Status, Spieler mit
  Host und Plattform, Alter, Version, Datenverkehr), Raum schließen und Spieler entfernen (Grund und
  Häkchen); ohne Relay in der API ruhiger Hinweis „Kein Relay eingerichtet“ (501), bei
  Relay-Ausfall „Relay gerade nicht erreichbar“ (502)
- **Löschprotokoll** (`/loeschungen`, P-026): Kontolöschungen laufen automatisch (im Spiel, auf der
  Website mit Einmal-Code, oder ein Admin löscht auf der Spielerseite); die Seite zeigt nur lesend,
  wann und auf welchem Weg gelöscht wurde, ohne Namen. Filter Zeitraum und Kanal, Zähler je Kanal,
  Suche nach Spieler-ID („wurde dieses Konto gelöscht?“; ohne Eintrag prüft die Seite, ob das Konto
  noch besteht). Moderatoren und Admins. Der alte Pfad `/loeschantraege` leitet dorthin um
  (`next.config.ts`).
- **Protokoll:** jede Änderung durch Admins/Moderatoren, filterbar nach Zeitraum, Bereich, Aktion,
  Ziel und Ziel-ID; alte Einträge entfallener Aktionen (`legal.*`, `deletion_request.resolve`)
  bleiben mit ihrer Beschriftung lesbar, sind aber nicht mehr filterbar
- **Admins:** Zugänge anlegen und deaktivieren (nur Rolle Admin)
- **Mein Konto** (`/konto`, jede Rolle; Link „Mein Konto“ bzw. die eigene E-Mail unten in der
  Seitenleiste): eigene E-Mail-Adresse ändern (neue Adresse + aktuelles Passwort, ohne
  Bestätigungsmail, gilt sofort; die Seitenleiste zeigt danach die neue Adresse) und eigenes Passwort
  ändern (aktuelles, neues mit mind. 12 Zeichen, Wiederholung; die Server Action prüft Länge und
  Wiederholung vor dem API-Aufruf). Nach dem Passwortwechsel sind alle anderen Sitzungen abgemeldet,
  die aktuelle bleibt (gleiches Cookie). Fehler wie „Das aktuelle Passwort ist falsch.“, „Diese
  E-Mail-Adresse ist bereits vergeben.“ oder zu viele Versuche erscheinen als Meldung oben.

Destruktive Aktionen laufen einheitlich über `components/danger-action.tsx`: Aufklappen, Grund
(Pflicht, wo die API einen Grund speichert), Bestätigung per Häkchen oder eingetipptem Kürzel/Namen;
die Server Action prüft die Bestätigung noch einmal. Ergebnisse erscheinen als Meldung oben auf der
Seite (`?ok=`, `?hinweis=`, `?fehler=`).

Gestaltung nach [docs/design/TOKENS.md](../../docs/design/TOKENS.md) §6 (Tokens in
`src/app/globals.css`); Logo, Favicon, Schrift (Pixelify Sans, OFL) und Pixel-Icons liegen als eigene
Kopie unter `public/brand/`, das Image hängt nicht vom Web-Ordner ab.

Aktionen, die die eigene Rolle nicht darf, werden ausgeblendet; die API prüft die Rechte zusätzlich.

Sicherheit und Sitzung (P-027): Die Anmeldung liefert ein Better-Auth-Session-Token
(`POST /admin/auth/login`, Antwort `{token, expiresAt, admin}`). Es liegt im **httpOnly-Cookie**
`soulwick_admin` (`SameSite=Strict`, in Produktion `Secure`), das genau bis `expiresAt` gilt (8 h ab
Anmeldung, ohne Verlängern). Alle API-Aufrufe laufen serverseitig (Server Actions / Server
Components); Browser-JavaScript sieht das Token nie. **Abmelden** beendet die Sitzung erst in der API
(`POST /admin/auth/logout`) und löscht dann das Cookie (auch wenn die API nicht antwortet).
Abgelaufene oder beendete Sitzungen führen zu `/login?abgelaufen=1` mit Hinweis: Lehnt die API das
Token ab (401), leitet `lib/api.ts` um; ist das Cookie schon abgelaufen, erkennt `proxy.ts` das am
Merker-Cookie `soulwick_admin_seen` (enthält nur „1“, 30 Tage, beim Abmelden gelöscht). Ist die API
nicht erreichbar, zeigt das Panel statt der Seite eine ruhige Fehlermeldung mit „Erneut versuchen“.
Die Oberfläche funktioniert ohne Client-JavaScript.

## Start (lokal)

```bash
bun install                                        # im Repo-Wurzelordner
cp apps/admin/.env.example apps/admin/.env.local   # API_URL anpassen
bun run dev:admin                                  # http://localhost:3001 (alles zusammen: bun dev)
```

Die API muss laufen (`bun run services:up`, `bun run db:deploy`, `bun run db:seed:dev`,
`bun run dev:api`). Dev-Zugänge aus dem Seed: `admin@soulwick.local` und `moderator@soulwick.local`,
Passwort `soulwick-admin-local` (oder `DEFAULT_ADMIN_PASSWORD`). Einen echten Admin legt der Basis-Seed der
API an (`DEFAULT_ADMIN_EMAIL`/`DEFAULT_ADMIN_PASSWORD`, `bun run db:seed`, siehe
[apps/api/README.md](../api/README.md)); danach Passwort unter „Mein Konto“ ändern.

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `API_URL` | `http://localhost:8787` | Adresse der API (nur serverseitig genutzt) |
| `ADMIN_COOKIE_SECURE` | `true` | Wirkt nur im Produktions-Build (`NODE_ENV=production`); nur auf `false` setzen, wenn dieser über reines http läuft (lokal gestartetes Image) |

## Befehle

| Befehl | Was passiert |
| --- | --- |
| `bun run --cwd apps/admin dev` | Entwicklungsserver auf Port 3001 |
| `bun run --cwd apps/admin build` | Produktions-Build (`output: "standalone"`) |
| `bun run --cwd apps/admin start` | Produktions-Build starten |
| `bun run --cwd apps/admin typecheck` | Routen-Typen erzeugen und TypeScript prüfen |
| `bunx biome check apps/admin` | Lint und Formatierung nur für das Admin-Panel (ganzes Repo: `bun run check`, Fixes: `bun run fix`) |

Docker: `docker build -f apps/admin/Dockerfile -t soulwick-admin .` (aus dem Repo-Wurzelordner). Bun
installiert nur im Build-Stage, das Image läuft als Next standalone auf `node:24-slim`.
Den Admin-Bereich im Internet zusätzlich schützen (siehe [infra/DOKPLOY.md](../../infra/DOKPLOY.md) §8).
