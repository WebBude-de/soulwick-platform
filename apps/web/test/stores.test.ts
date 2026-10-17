import { describe, expect, it } from "bun:test";
import shipped from "../content/stores.json";
import { platformTiles } from "../src/lib/platforms.ts";
import {
  parseStoresFile,
  STORE_IDS,
  type StoreId,
  steamStoreUrl,
  storeLinks,
} from "../src/lib/stores.ts";

/**
 * Store pages (`content/stores.json`) and the platform tiles of the hero derived from them, the
 * live switch and the browser game: nothing may claim more than is true, before or after release.
 */

const STEAM = "https://store.steampowered.com/app/123/Soulwick/";
const PLAY =
  "https://play.google.com/store/apps/details?id=de.webbude.soulwick";
const APPLE = "https://apps.apple.com/app/soulwick/id123";
const GAME = {
  play: "https://game.test/",
  install: "https://game.test/?install",
};
const NO_STORES = { app_store: null, google_play: null, steam: null };
const badgeFile = (store: StoreId) => ({
  src: `/brand/stores/${store}.webp`,
  width: 10,
  height: 4,
});
const noBadge = () => null;

describe("shipped stores.json", () => {
  it("is valid and the shown links follow it", () => {
    const parsed = parseStoresFile(shipped);
    expect(Object.keys(shipped).sort()).toEqual([...STORE_IDS].sort());
    expect(storeLinks()).toEqual(parsed);
    expect(steamStoreUrl()).toBe(parsed.steam);
  });
});

describe("parseStoresFile", () => {
  it("turns empty entries into null and trims urls", () => {
    expect(
      parseStoresFile({ steam: ` ${STEAM} `, google_play: "", app_store: "" })
    ).toEqual({ steam: STEAM, google_play: null, app_store: null });
  });

  it("only accepts https product pages of the matching store", () => {
    const bad = [
      { steam: "http://store.steampowered.com/app/1" },
      { steam: "https://steamcommunity.com/app/1" },
      { google_play: APPLE },
      { app_store: "https://apple.com/app-store/" },
      { app_store: "javascript:alert(1)" },
    ];
    for (const entry of bad) {
      expect(() =>
        parseStoresFile({ steam: "", google_play: "", app_store: "", ...entry })
      ).toThrow("stores.json");
    }
  });

  it("rejects missing and unknown stores", () => {
    expect(() => parseStoresFile({ steam: "", google_play: "" })).toThrow();
    expect(() =>
      parseStoresFile({ steam: "", google_play: "", app_store: "", epic: "" })
    ).toThrow();
  });
});

describe("platformTiles", () => {
  it("before the release: every platform 'at release', no links, no badges", () => {
    const tiles = platformTiles({
      live: false,
      game: GAME,
      stores: { app_store: APPLE, google_play: PLAY, steam: STEAM },
      badge: badgeFile,
    });
    expect(tiles.map((t) => t.id)).toEqual([
      "browser",
      "steam",
      "android",
      "ios",
    ]);
    for (const tile of tiles) {
      expect(tile).toMatchObject({
        status: "atRelease",
        href: null,
        badge: null,
      });
    }
  });

  it("live without links yet: 'later', never 'at release'", () => {
    const tiles = platformTiles({
      live: true,
      game: null,
      stores: NO_STORES,
      badge: badgeFile,
    });
    expect(tiles.map((t) => t.status)).toEqual([
      "later",
      "later",
      "later",
      "later",
    ]);
  });

  it("live with links: playable, official badges first with the App Store leading", () => {
    const tiles = platformTiles({
      live: true,
      game: GAME,
      stores: { app_store: APPLE, google_play: PLAY, steam: STEAM },
      badge: (store) => (store === "steam" ? null : badgeFile(store)),
    });
    expect(
      tiles.map((t) => [t.id, t.status, t.href, Boolean(t.badge)])
    ).toEqual([
      ["ios", "playable", APPLE, true],
      ["android", "playable", PLAY, true],
      ["browser", "playable", GAME.play, false],
      ["steam", "playable", STEAM, false],
    ]);
  });

  it("without badge files every platform keeps its own tile in the usual order", () => {
    const tiles = platformTiles({
      live: true,
      game: GAME,
      stores: { app_store: APPLE, google_play: null, steam: STEAM },
      badge: noBadge,
    });
    expect(tiles.map((t) => [t.id, t.status])).toEqual([
      ["browser", "playable"],
      ["steam", "playable"],
      ["android", "later"],
      ["ios", "playable"],
    ]);
  });
});
