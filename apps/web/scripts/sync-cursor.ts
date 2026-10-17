/**
 * Copies the game's mouse cursors into `public/brand/cursor/`, so the website uses exactly the
 * in-game cursors (`globals.css`): the pixel arrow from the menus and the crosshair from the
 * dungeon (`components/visual/cursor.gd` in the game, drawn by `tools/generate_cursors.py` as
 * 12×16 and 15×15 pixel art, saved at 2×).
 *
 *   bun apps/web/scripts/sync-cursor.ts
 *
 * Source: `../soulwick/art/ui` next to this repository (override with SOULWICK_UI_DIR).
 * Output per cursor (`pointer`, `crosshair`):
 *   <name>.png        the game file byte for byte, used at 1× (24×32 and 30×30 CSS px)
 *   <name>@1.5x.png   3 device pixels per art pixel
 *   <name>@2x.png     4 device pixels per art pixel
 *   <name>@3x.png     6 device pixels per art pixel
 * The larger files are scaled from the art grid with nearest neighbour, so every screen density
 * gets whole, crisp pixels instead of a blurry browser upscale. The files stay PNG (CSS cursors
 * need it; `sync-brand.ts` skips this folder).
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.resolve(here, "..");
const uiDir = path.resolve(
  process.env.SOULWICK_UI_DIR ??
    path.join(webRoot, "..", "..", "..", "soulwick", "art", "ui")
);
const outDir = path.join(webRoot, "public", "brand", "cursor");

/** Website name → game file. The game saves its cursors at 2× the art. */
const CURSORS: Record<string, string> = {
  pointer: "cursor_pointer.png",
  crosshair: "cursor_crosshair.png",
};
const GAME_SCALE = 2;
/** Density suffix → device pixels per art pixel. */
const DENSITIES: [suffix: string, factor: number][] = [
  ["@1.5x", 3],
  ["@2x", 4],
  ["@3x", 6],
];

async function sync(name: string, file: string): Promise<string[]> {
  const src = path.join(uiDir, file);
  if (!existsSync(src)) {
    return [`skip ${name}: ${src} not found`];
  }
  const base = path.join(outDir, `${name}.png`);
  await copyFile(src, base);
  const { width = 0, height = 0 } = await sharp(src).metadata();
  const artWidth = Math.round(width / GAME_SCALE);
  const artHeight = Math.round(height / GAME_SCALE);
  const art = await sharp(src)
    .resize(artWidth, artHeight, { kernel: "nearest" })
    .png()
    .toBuffer();
  const scaled = await Promise.all(
    DENSITIES.map(async ([suffix, factor]) => {
      const dest = path.join(outDir, `${name}${suffix}.png`);
      await sharp(art)
        .resize(artWidth * factor, artHeight * factor, { kernel: "nearest" })
        .png({ compressionLevel: 9 })
        .toFile(dest);
      const size = (await stat(dest)).size;
      return `${name}${suffix}.png ${artWidth * factor}×${artHeight * factor} (${size} B)`;
    })
  );
  const lines = [`${name}.png ${width}×${height} (game file)`, ...scaled];
  return lines;
}

await mkdir(outDir, { recursive: true });
const results = await Promise.all(
  Object.entries(CURSORS).map(([name, file]) => sync(name, file))
);
for (const line of results.flat()) {
  console.log(line);
}
