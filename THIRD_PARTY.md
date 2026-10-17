# Fremde Bestandteile und Lizenzen

Der Code der Soulwick-Plattform steht unter der GNU General Public License v3 oder später
([LICENSE](LICENSE)). **Ausgenommen** sind die Inhalte: Grafiken, Musik und Klänge, Logo, der Name
„Soulwick“ und die Figuren Wick und das Huhn – alle Rechte vorbehalten, Regeln in
[LICENSE-ASSETS.md](LICENSE-ASSETS.md). Diese Teile stammen von anderen oder stehen unter eigener
Lizenz:

| Teil | Ort | Lizenz |
| --- | --- | --- |
| npm-Pakete (Next.js, React, Hono, Prisma, Better Auth, zod …) | `node_modules/`, siehe `bun.lock` | jeweils eigene Lizenz (meist MIT oder Apache-2.0) |
| DM Sans (Schrift, über `next/font/google`) | – | SIL Open Font License 1.1 |
| Pixelify Sans (Schrift) | `apps/web/public/brand/fonts/`, `apps/admin/public/brand/fonts/` | SIL Open Font License 1.1, [OFL-PixelifySans.txt](apps/web/public/brand/fonts/OFL-PixelifySans.txt) |
| **Grafiken der Website und des Admin-Panels** (Sprites, Logo, Keyart, Icons, Bilder) | `apps/web/public/`, `apps/admin/public/` (außer `brand/fonts/`), Bilder unter `docs/design/` und `.github/assets/` | **Alle Rechte vorbehalten, WebBude** – nicht GPL, [LICENSE-ASSETS.md](LICENSE-ASSETS.md) |
| **Musik und Klänge** (aus dem Spiel übernommen) | `apps/web/public/audio/` | **Alle Rechte vorbehalten, WebBude** – nicht GPL, [LICENSE-ASSETS.md](LICENSE-ASSETS.md) |
| **Name „Soulwick“, Logo, Figuren Wick und Huhn** | überall | **Alle Rechte vorbehalten, WebBude**, [LICENSE-ASSETS.md](LICENSE-ASSETS.md) |

---

**English:** The code is GPL-3.0-or-later. Artwork, music and sound, the logo, the name "Soulwick" and
the characters (Wick, the chicken) are all rights reserved, see [LICENSE-ASSETS.md](LICENSE-ASSETS.md).
Third-party parts keep their own licences as listed above.
