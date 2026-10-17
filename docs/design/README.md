# Design – Tokens, Handoffs und Mockups

> **Stand:** 17.10.2026 · Hier liegt alles, was aus Claude Design kommt oder dafür geschrieben wird (Übergaben, Konzepte, Grafik-Briefings und Mockups je App), plus das gemeinsame Design-System. Produktkontext: [`soulwick/docs/PRODUKT.md`](../../../soulwick/docs/PRODUKT.md).

## Ordnerregeln

- **`design/<app>/`** je App (`web/` für die Website, `admin/` für das Admin-Panel): Mockups und die Übergabe aus Claude Design.
- **`TOKENS.md`** ist gemeinsam: Farben, Schriften, Pixel-Komponenten, Skalierung, Kontrast für Web **und** Admin.
- **Handoffs** aus Claude Design heißen `HANDOFF_<APP>.md` und sind **verbindlich** für Layout und Komponenten der jeweiligen App, solange die Tabelle unten sie nicht als abgelöst führt.
- **Konzepte** heißen `KONZEPT_<APP>.md`: Begründung, Seitenstruktur, Mockup-Wünsche, offene Fragen. Weicht ein Konzept von einem gültigen Handoff ab, gilt der Handoff; für die Website ist seit 17.10.2026 das Konzept maßgeblich.
- **Grafik-Briefings** heißen `BRIEFING_<APP>.md`: fehlende Grafiken der App mit Datei, Größe, Beschreibung und Ablageort, als Auftrag für Claude Design.
- **Mockups** als PNG oder WebP (Pixel-Art verlustfrei), Dateiname `<seite>_<gerät>_<sprache>[_ausschnitt].png`, z. B. `landing_desktop_de.png`.
- Asset-Pakete aus Claude Design (Logos, Sprites, Schriften, Texte) gehören nicht hierher, sondern nach `apps/<app>/public/` (Website: `apps/web/public/brand/`, siehe dortige README).

## Aktuelle Dateien

| Datei | Was | Status |
| --- | --- | --- |
| [TOKENS.md](TOKENS.md) | Design-Tokens für Web und Admin (aus HANDOFF_WEB §2 und §7) | gültig |
| [web/HANDOFF_WEB.md](web/HANDOFF_WEB.md) | Übergabe Landingpage: Assets, Tokens, Seitenaufbau, Sprite-Animation, Easter Eggs, Zustände, Barrierefreiheit | abgelöst (17.10.2026); Layout und Pixel-Komponenten nur Inspiration |
| `web/landing_desktop_de.png` (1280 × 5706), `web/landing_desktop_en.png` (1280 × 5615) | Startseite Desktop, ganze Seite, DE/EN | geliefert; alte Positionierung, nur Inspiration |
| `web/landing_mobile_de.png` (390 × 10349) | Startseite Mobil, ganze Seite | geliefert; alte Positionierung, nur Inspiration |
| `web/landing_desktop_de_hero.png` (1280 × 760), `web/landing_mobile_de_top.png` (390 × 900) | Ausschnitte Hero und Mobil oben | geliefert; alte Positionierung, nur Inspiration |
| [web/KONZEPT_WEB.md](web/KONZEPT_WEB.md) | Website-Konzept: Zweck, Ton, Erzählung der Startseite, Seiten, Neuigkeiten, Mockup-Wünsche, offene Fragen | **gültig** (D-173 bis D-179), maßgeblich für Erzählung und Seitenaufbau |
| [web/BRIEFING_WEB.md](web/BRIEFING_WEB.md) | Grafik-Briefing Website: Wick, Dorf bei Tag, Teilen-Bilder (Open Graph) | offen (Lieferung durch das Projektmitglied) |
| [admin/README.md](admin/README.md) | Admin-Design: Umfang, Regeln, umgesetzter Stand (Admin Design v2) und Abweichungen von TOKENS.md | kein Handoff, keine Mockups |

## Wer schreibt was

- **Projektmitglied:** legt die Ausgabe von Claude Design hier ab (Handoff, Mockups) und das Asset-Paket unter `apps/<app>/public/`; beantwortet die offenen Fragen der Konzepte.
- **Agenten (`web-dev`, `admin-dev`):** lesen das gültige Konzept bzw. den Handoff ihrer App und TOKENS.md und bauen danach; sie ändern Handoffs und Mockups **nie**. Abweichungen und fehlende Grafiken stehen im Bericht; Grafikwünsche für die Website kommen in [web/BRIEFING_WEB.md](web/BRIEFING_WEB.md) (ältere Website-Grafiken: `soulwick/docs/design/sprites/SPRITES_V5.md` §8).
- **Integrator:** pflegt diese README, `TOKENS.md` und die Konzepte; trägt gelieferte Mockups in die Tabellen ein.

## Bezug zum Spiel

Die Spiel-Oberfläche hat eigene Referenz-Screens in `soulwick/docs/design/` (`mockups/screens/`, `mockups/backgrounds/`, `ui_spec.json`); für die Website sind sie nur Inspiration. Palette, Maßstab und Namensregeln für Spiel und Web: `soulwick/docs/HANDOUT.md`.
