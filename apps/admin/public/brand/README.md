# Marken-Dateien des Admin-Panels (`apps/admin/public/brand/`)

Kopien aus `apps/web/public/brand/` (bzw. `apps/web/public/sprites/ui/` für `icon_lock`, `icon_info`,
`icon_ping_good`), damit das Admin-Image nicht vom Web-Ordner abhängt. Bei neuen Grafiken im Web-Paket
hier von Hand nachziehen.

| Datei | Verwendung |
| --- | --- |
| `favicon-32.png`, `logo_square.svg` | Favicon (`metadata.icons`) |
| `apple-touch-icon.png` | 192×192, aus `logo_square.webp` 3× (nächster Nachbar) auf `--bg` |
| `logo.webp`, `logo_square.webp` | Logo in Seitenleiste und Anmeldung (640×192, gezeigt 160×48 bzw. 320×96) |
| `fonts/PixelifySans-Variable.ttf` + `OFL-PixelifySans.txt` | Display-Schrift (`next/font/local`) |
| `sprites/*.webp` | 16-px-Icons der Navigation und Kacheln (`src/components/pixel-icon.tsx`), `divider.webp` |
