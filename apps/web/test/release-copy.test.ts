import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * The website describes Soulwick as it is at release, in both modes of `LIVE_FEATURES`
 * (KONZEPT_WEB §1): no teaser words for what is part of the release (co-op, wish bosses, Wick,
 * village, outfits, guilds, leaderboards; every platform), in the messages and the news. "Later"
 * and "after the release" stay allowed for what really comes later (party mode, new content).
 */

const webRoot = path.resolve(import.meta.dir, "..");
const LOCALES = ["en", "de"] as const;
/** Message files with feature copy (legal and deletion texts describe today's processing). */
const NAMESPACES = ["common", "landing", "news", "leaderboards", "opensource"];

const TEASER_WORDS: RegExp[] = [
  /\bin arbeit\b/i,
  /\bin the works\b/i,
  /\bzieht gerade\b/i,
  /\bmoving into\b/i,
  /\bgeplant\b/i,
  /\bplanned\b/i,
  /\bcoming soon\b/i,
  /\bkommt bald\b/i,
  /\bon its way\b/i,
  /\bunterwegs\b/i,
  /\bwork in progress\b/i,
  /\bplatzhalter\b/i,
  /\bstand-in\b/i,
];

function teaserHits(text: string): string[] {
  return TEASER_WORDS.filter((word) => word.test(text)).map(String);
}

describe("release copy", () => {
  for (const locale of LOCALES) {
    for (const namespace of NAMESPACES) {
      it(`messages/${locale}/${namespace}.json has no teaser words`, () => {
        const text = readFileSync(
          path.join(webRoot, "messages", locale, `${namespace}.json`),
          "utf8"
        );
        expect(teaserHits(text)).toEqual([]);
      });
    }
  }

  it("news posts have no teaser words", () => {
    const newsDir = path.join(webRoot, "content", "news");
    const posts = readdirSync(newsDir).filter((entry) =>
      statSync(path.join(newsDir, entry)).isDirectory()
    );
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      for (const locale of LOCALES) {
        const text = readFileSync(
          path.join(newsDir, post, `${locale}.md`),
          "utf8"
        );
        expect({ post, locale, hits: teaserHits(text) }).toEqual({
          post,
          locale,
          hits: [],
        });
      }
    }
  });

  it("both languages describe the same landing sections", () => {
    const keys = (locale: string) =>
      Object.keys(
        JSON.parse(
          readFileSync(
            path.join(webRoot, "messages", locale, "landing.json"),
            "utf8"
          )
        )
      );
    expect(keys("de")).toEqual(keys("en"));
  });
});

/** Cursor file suffix → device pixels per art pixel (`scripts/sync-cursor.ts`). */
const DENSITIES = [
  ["", 2],
  ["@1.5x", 3],
  ["@2x", 4],
  ["@3x", 6],
] as const;

describe("in-game assets", () => {
  const brandDir = path.join(webRoot, "public", "brand");

  it("ships the game's cursors in every density with whole pixels", async () => {
    const expected: Record<string, [number, number]> = {
      pointer: [12, 16],
      crosshair: [15, 15],
    };
    const files = Object.entries(expected).flatMap(([name, [w, h]]) =>
      DENSITIES.map(([suffix, factor]) => ({
        file: `${name}${suffix}.png`,
        size: [w * factor, h * factor],
      }))
    );
    const sizes = await Promise.all(
      files.map(async ({ file }) => {
        const meta = await sharp(
          path.join(brandDir, "cursor", file)
        ).metadata();
        return [meta.width, meta.height];
      })
    );
    expect(sizes).toEqual(files.map(({ size }) => size));
  });

  it("ships the village from the game as a small WebP", async () => {
    const file = path.join(brandDir, "village_ingame.webp");
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([1280, 720]);
    expect(statSync(file).size).toBeLessThan(300 * 1024);
  });
});
