# Soulwick Platform – Lizenz der Inhalte / Content licence

Code offen, Inhalte geschützt. **English below.** · Entscheidung: D-177 im Spiel-Repo
([soulwick/docs/DECISIONS.md](https://github.com/WebBude-de/soulwick/blob/main/docs/DECISIONS.md))

## Deutsch

### 1. Der Code ist frei

Der Quellcode dieses Repositorys steht unter der **GNU General Public License v3.0 oder später**
(GPL-3.0-or-later, [LICENSE](LICENSE)): Website, Admin-Panel, API, Relay, Verträge, Datenbank-Schema
und Migrationen, Skripte, Dockerfiles und Konfiguration – alles außer den Inhalten aus Abschnitt 2
(fremde Bestandteile: Abschnitt 4). Du darfst ihn lesen, ändern, weitergeben und für eigene Projekte
verwenden – unter den Bedingungen der GPL.

### 2. Die Inhalte sind ausgenommen: alle Rechte vorbehalten

© 2026 WebBude. Diese Teile stehen **nicht** unter der GPL:

| Was | Wo |
| --- | --- |
| Grafiken der Website und des Admin-Panels (Logo, Keyart, Sprites, Icons, Bilder) | `apps/web/public/` und `apps/admin/public/`, jeweils außer `brand/fonts/` |
| Musik und Klänge | `apps/web/public/audio/` |
| Bilder für Doku und GitHub (Mockups, Banner) | `docs/design/`, `.github/assets/` |
| Logo und der Name **„Soulwick“** als Kennzeichen des Spiels | überall |
| Die Figuren **Wick** (das Docht-Wesen) und **das Huhn**, ihr Aussehen und ihre Namen | überall |

Viele dieser Dateien sind Kopien aus dem Spiel-Repo (`bun apps/web/scripts/sync-*.ts`) und gehören
dort ebenfalls zu den Inhalten
([soulwick/LICENSE-ASSETS.md](https://github.com/WebBude-de/soulwick/blob/main/LICENSE-ASSETS.md)).
Die Sync-Skripte selbst sind Code (GPL).

Ohne schriftliche Erlaubnis von WebBude dürfen diese Inhalte nicht kopiert, verändert, weitergegeben
oder in anderen Projekten verwendet werden, außer wie in Abschnitt 3 beschrieben.

### 3. Was erlaubt ist

- **Lokal betreiben und ausprobieren:** Du darfst die Plattform aus diesem Repository bauen und lokal
  laufen lassen, auch mit Änderungen am Code.
- **Forken und beitragen:** Forks auf GitHub, um Änderungen vorzuschlagen, sind ausdrücklich erwünscht
  ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Eigene Projekte aus dem Code:** Wer den Code öffentlich betreibt (eigene Website, eigener Server),
  ersetzt alle Inhalte aus Abschnitt 2 durch **eigene** und verwendet einen **anderen Namen** und ein
  anderes Logo. Es darf nicht so aussehen, als sei es Soulwick oder ein offizielles Angebot von
  WebBude.
- **Videos, Streams und Screenshots** von Soulwick und seiner Website sind ausdrücklich **erlaubt und
  erwünscht**, auch monetarisiert. Nicht gemeint ist, Inhalte herauszulösen und einzeln zu verwerten
  (z. B. Musik, Sprites, Merchandise).

### 4. Fremde Bestandteile

Teile von anderen behalten ihre eigene Lizenz, z. B. die Schrift Pixelify Sans in
`apps/*/public/brand/fonts/` (SIL Open Font License 1.1) und alle npm-Pakete. Liste:
[THIRD_PARTY.md](THIRD_PARTY.md).

### 5. Fragen

Du willst etwas machen, das hier nicht steht? Schreib uns an
[hello@playsoulwick.com](mailto:hello@playsoulwick.com).

---

## English

### 1. The code is free

The source code in this repository is licensed under the **GNU General Public License v3.0 or later**
(GPL-3.0-or-later, [LICENSE](LICENSE)): website, admin panel, API, relay, contracts, database schema
and migrations, scripts, Dockerfiles and configuration – everything except the content listed in
section 2 (third-party parts: section 4). You may read, change and share it and use it for your own
projects under the terms of the GPL.

### 2. The content is excluded: all rights reserved

© 2026 WebBude. These parts are **not** covered by the GPL:

| What | Where |
| --- | --- |
| Artwork of the website and the admin panel (logo, key art, sprites, icons, images) | `apps/web/public/` and `apps/admin/public/`, except `brand/fonts/` |
| Music and sound | `apps/web/public/audio/` |
| Images for docs and GitHub (mockups, banners) | `docs/design/`, `.github/assets/` |
| The logo and the name **"Soulwick"** as the name of the game | everywhere |
| The characters **Wick** (the little wick creature) and **the chicken**, their look and their names | everywhere |

Many of these files are copies from the game repository (`bun apps/web/scripts/sync-*.ts`) and are
content there as well
([soulwick/LICENSE-ASSETS.md](https://github.com/WebBude-de/soulwick/blob/main/LICENSE-ASSETS.md)).
The sync scripts themselves are code (GPL).

Without written permission from WebBude this content may not be copied, modified, redistributed or
used in other projects, except as described in section 3.

### 3. What you may do

- **Run it locally:** you may build the platform from this repository and run it locally, including
  changes to the code.
- **Fork and contribute:** forks on GitHub to propose changes are welcome
  ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Your own project from the code:** if you run the code publicly (your own website or server),
  replace all content from section 2 with **your own** and use a **different name** and logo. It must
  not look like Soulwick or like an official WebBude service.
- **Videos, streams and screenshots** of Soulwick and its website are explicitly **allowed and
  welcome**, monetized ones included. This does not cover extracting content and using it on its own
  (music, sprites, merchandise).

### 4. Third-party parts

Parts made by others keep their own licence, for example the Pixelify Sans font in
`apps/*/public/brand/fonts/` (SIL Open Font License 1.1) and all npm packages. Full list:
[THIRD_PARTY.md](THIRD_PARTY.md).

### 5. Questions

Want to do something that is not covered here? Write to
[hello@playsoulwick.com](mailto:hello@playsoulwick.com).
