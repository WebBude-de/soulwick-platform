# Rechtstexte als Rückfall (`content/legal/`)

Impressum und Datenschutzerklärung kommen normalerweise über die API von eRecht24 (P-025,
`GET /legal/:type`). Liefert die API keinen Text (Schlüssel fehlen, `status: "missing"`, oder die API
ist nicht erreichbar), zeigt die Website eine Datei aus diesem Ordner, **falls es sie gibt**:

| Datei | Seite |
| --- | --- |
| `imprint.de.html`, `imprint.en.html` | `/imprint` |
| `privacy.de.html`, `privacy.en.html` | `/privacy` |

- Zuerst die Datei der Seitensprache, sonst die der anderen Sprache (mit Hinweis „liegt nur auf … vor“).
  Ohne Datei bleibt der Platzhalter mit dem Kurzüberblick.
- Inhalt: nur der Text als HTML-Ausschnitt (`<h2>`, `<p>`, `<ul>`, `<a>` …), ohne `<h1>` (die Seite hat
  ihre eigene Überschrift). Die Website baut das HTML über dieselbe Allowlist wie die eRecht24-Texte neu
  auf (`src/components/legal/html-to-react.tsx`); Skripte, Styles und Bilder fallen weg.
- Die Dateien liefert das Projektmitglied (z. B. aus dem eRecht24-Generator). Agenten legen hier keine
  Rechtstexte an und erfinden keine Namen oder Adressen.
- Die Dateien werden zur Laufzeit gelesen und in den Standalone-Build übernommen
  (`outputFileTracingIncludes` in `next.config.ts`). Eine neue oder geänderte Datei braucht deshalb einen
  neuen Build bzw. ein neues Image.
