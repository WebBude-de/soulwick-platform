# Neuigkeiten (`content/news/`)

Beiträge für `/news` (Übersicht) und `/news/<slug>` (Beitrag). Ein Ordner je Beitrag, darin eine
Datei je Sprache:

```text
content/news/
  where-we-are-headed/
    en.md
    de.md
```

- **Ordnername = Adresse:** englisch, Kleinbuchstaben, Ziffern und Bindestriche
  (`/news/where-we-are-headed`). Gleicher Ordner für beide Sprachen.
- **Sprachen:** `en.md` und `de.md`. Fehlt eine, zeigt die Seite die andere mit Hinweis.
- **Kopf (Pflicht):**

  ```markdown
  ---
  title: Wohin die Reise geht
  date: 2026-10-17
  summary: Ein, zwei Sätze für Übersicht, Startseite und Teilen-Vorschau.
  image: /brand/news/where-we-are-headed.webp
  draft: false
  ---
  ```

  `title` und `date` (`JJJJ-MM-TT`) sind Pflicht, sonst wird der Beitrag übersprungen. `image` ist
  optional (1200 × 630, WebP, unter `public/brand/`) und erscheint nur, wenn die Datei existiert.
  `draft: true` versteckt den Beitrag.
- **Text:** kleines Markdown: `## Überschrift`, `### Unterüberschrift`, Absätze, Listen mit `- `,
  Zitate mit `> `, `**fett**`, `*kursiv*`, Links `[Text](https://…)` oder `[Text](/news)`. Mehr
  (Bilder, Tabellen, HTML) wird bewusst nicht unterstützt.
- **Ton:** Spielersprache wie auf der Startseite, Deutsch in Du-Form, keine Technik-Begriffe.
  Was zum Release im Spiel ist (Koop, Wunsch-Bosse, Wick, Dorf, Gilden, Ranglisten, Outfits),
  wird beschrieben, wie es dann ist, ohne „kommt“ oder „in Arbeit“; „danach“ nur für Späteres
  (Party-Modus, neue Inhalte). Zum Release ist Soulwick im Browser, auf Steam, Android und iOS
  spielbar. Keine Preise, keine Termine, die nicht feststehen (D-173 bis
  D-179, `docs/design/web/KONZEPT_WEB.md` §1).
- Neueste Beiträge stehen oben (nach `date`). Die zwei neuesten erscheinen auch auf der Startseite.
- `/news` und die Beiträge werden beim Build je Sprache vorab erzeugt; ein neuer Beitrag braucht
  einen neuen Build (Deploy). Die Dateien liegen trotzdem im Standalone-Build
  (`outputFileTracingIncludes` in `next.config.ts`), weil Startseite und Sitemap sie lesen.
