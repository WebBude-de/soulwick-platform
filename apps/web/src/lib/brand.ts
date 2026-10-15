import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Optional website graphics the project member drops into `public/brand/` (see the README
 * there). Checked on the server at render time; the page falls back to game sprites.
 */
const brandDir = path.join(process.cwd(), "public", "brand");

export type BiomeId = "crypt" | "slime_grotto" | "shadow_realm" | "ember_forge";

export function brandAsset(fileName: string): string | null {
  return existsSync(path.join(brandDir, fileName))
    ? `/brand/${fileName}`
    : null;
}

export const brand = {
  logo: () => brandAsset("logo.webp"),
  logoSquare: () => brandAsset("logo_square.webp"),
  keyart: () => brandAsset("keyart.webp"),
  ogImage: () => brandAsset("og_image.webp"),
  biome: (id: BiomeId) => brandAsset(`biome_${id}.webp`),
};
