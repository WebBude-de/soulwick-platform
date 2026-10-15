/**
 * Converts the delivered website graphics in `public/brand/**` (PNG, see the README there) to the
 * WebP files the site reads. Pixel art stays lossless; `keyart` and `og_image` use quality 90.
 * The PNG originals are deleted after a successful conversion so they do not ship with the build
 * (`--keep-png` keeps them). `cursor.png` and `favicon-32.png` stay PNG (CSS cursors and
 * favicons need it).
 *
 *   bun apps/web/scripts/sync-brand.ts
 *   bun apps/web/scripts/sync-brand.ts --keep-png
 */
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = fileURLToPath(new URL(".", import.meta.url));
const brandDir = path.resolve(here, "..", "public", "brand");
const keepPng = process.argv.includes("--keep-png");

const PNG = /\.png$/i;
const LOSSY = new Set(["keyart.png", "og_image.png"]);
const SKIP = new Set(["cursor.png", "favicon-32.png"]);

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, acc);
      } else if (PNG.test(entry.name)) {
        acc.push(full);
      }
    })
  );
  return acc;
}

async function convert(
  src: string
): Promise<{ png: number; webp: number; line: string }> {
  const name = path.basename(src);
  const dest = src.replace(PNG, ".webp");
  const lossless = !LOSSY.has(name);
  await sharp(src)
    .webp(lossless ? { lossless: true, effort: 6 } : { quality: 90, effort: 6 })
    .toFile(dest);
  const [s, d] = await Promise.all([stat(src), stat(dest)]);
  if (!keepPng) {
    await unlink(src);
  }
  return {
    png: s.size,
    webp: d.size,
    line: `${path.relative(brandDir, dest)}: ${(s.size / 1024).toFixed(0)} KB → ${(d.size / 1024).toFixed(0)} KB${lossless ? "" : " (q90)"}`,
  };
}

const files = (await walk(brandDir))
  .filter((file) => !SKIP.has(path.basename(file)))
  .sort();
const results = await Promise.all(files.map((file) => convert(file)));
for (const r of results) {
  console.log(r.line);
}
const pngBytes = results.reduce((sum, r) => sum + r.png, 0);
const webpBytes = results.reduce((sum, r) => sum + r.webp, 0);
console.log(
  `brand: ${results.length} files, ${(pngBytes / 1024).toFixed(0)} KB PNG → ${(webpBytes / 1024).toFixed(0)} KB WebP${keepPng ? "" : ", PNG originals removed"}`
);
