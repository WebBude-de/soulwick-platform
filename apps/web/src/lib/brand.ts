import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { BadgeImage } from "./platforms";
import type { StoreId } from "./stores";

/**
 * Optional website graphics the project member drops into `public/brand/` (see the README
 * there and `docs/design/web/BRIEFING_WEB.md`). Checked on the server at render time; until a
 * file exists the page shows a placeholder drawn in code or a game sprite. A delivered file with
 * the agreed name replaces the placeholder without a code change.
 */
const brandDir = path.join(process.cwd(), "public", "brand");

export type BiomeId = "crypt" | "slime_grotto" | "shadow_realm" | "ember_forge";

export function brandAsset(fileName: string): string | null {
  return existsSync(path.join(brandDir, fileName))
    ? `/brand/${fileName}`
    : null;
}

export interface BrandImage {
  height: number;
  src: string;
  width: number;
}

/** Wick, the mascot (D-175). No art yet: `WickFigure` draws a placeholder until these exist. */
export interface WickArt {
  /** Large illustration for "Meet Wick" (`wick/wick_hero.webp`, transparent). */
  hero: string | null;
  /** Idle strip, 6 frames of 32×32 (`wick/wick_idle_6f.webp`). */
  idle: string | null;
  /** Wick together with the chicken (`wick/wick_chicken.webp`, transparent). */
  withChicken: string | null;
}

export const brand = {
  logo: () => brandAsset("logo.webp"),
  logoSquare: () => brandAsset("logo_square.webp"),
  keyart: () => brandAsset("keyart.webp"),
  /** Share image in the page language with the tagline (1200×630), else the generic one. */
  ogImage: (locale?: string): BrandImage | null => {
    const localized = locale ? brandAsset(`og_image_${locale}.webp`) : null;
    if (localized) {
      return { src: localized, width: 1200, height: 630 };
    }
    const generic = brandAsset("og_image.webp");
    return generic ? { src: generic, width: 1200, height: 632 } : null;
  },
  biome: (id: BiomeId) => brandAsset(`biome_${id}.webp`),
  /**
   * The village as it looks in the game today, by day (1280×720 screenshot, lossless; refresh
   * with `scripts/sync-village.ts`). Falls back to the older game scene (480×270).
   */
  village: (): BrandImage | null => {
    const shot = brandAsset("village_ingame.webp");
    if (shot) {
      return { src: shot, width: 1280, height: 720 };
    }
    const scene = brandAsset("scenes/village.webp");
    return scene ? { src: scene, width: 480, height: 270 } : null;
  },
  wick: (): WickArt => ({
    idle: brandAsset("wick/wick_idle_6f.webp"),
    hero: brandAsset("wick/wick_hero.webp"),
    withChicken: brandAsset("wick/wick_chicken.webp"),
  }),
  /**
   * Official store badge in the page language (else English), exactly as the store provides it
   * (`public/brand/stores/`, see the README there). `null` until the file is there: the page then
   * keeps its own tile without any store logo.
   */
  storeBadge: (store: StoreId, locale: string): BadgeImage | null => {
    const badge = STORE_BADGES[store];
    for (const lang of [locale, "en"]) {
      for (const ext of badge.formats) {
        const src = brandAsset(`stores/${badge.file}.${lang}.${ext}`);
        if (src) {
          return { src, width: badge.width, height: badge.height };
        }
      }
    }
    return null;
  },
};

/**
 * Badge files per store: name, accepted formats (as the store ships them, converted to WebP
 * only losslessly) and the nominal artwork size, which only sets the proportions before the
 * file has loaded.
 */
const STORE_BADGES: Record<
  StoreId,
  { file: string; formats: string[]; height: number; width: number }
> = {
  app_store: {
    file: "app-store-badge",
    formats: ["svg", "webp"],
    width: 120,
    height: 40,
  },
  google_play: {
    file: "google-play-badge",
    formats: ["webp"],
    width: 646,
    height: 250,
  },
  steam: {
    file: "steam-logo",
    formats: ["svg", "webp"],
    width: 180,
    height: 54,
  },
};
