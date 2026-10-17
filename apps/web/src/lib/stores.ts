import { z } from "zod";
import file from "../../content/stores.json";

/**
 * Store pages of Soulwick from `content/stores.json` (edited by the project member, see the web
 * README): Steam, Google Play and the App Store, each empty until the page exists. Validated once
 * when this module loads, so a typo fails the build instead of shipping a broken link. Each URL
 * must point to that store's own product page: the official badges may only link there (Apple,
 * Google), and the Steam page doubles as the wishlist before the release.
 */
export const STORE_IDS = ["app_store", "google_play", "steam"] as const;

export type StoreId = (typeof STORE_IDS)[number];

/** Store page per store, `null` while there is none. */
export type StoreLinks = Record<StoreId, string | null>;

/** Hosts of the product pages: `https://<host>/…`. */
const STORE_HOSTS: Record<StoreId, string> = {
  app_store: "apps.apple.com",
  google_play: "play.google.com",
  steam: "store.steampowered.com",
};

function storeUrl(id: StoreId) {
  return z
    .string()
    .trim()
    .refine(
      (value) => {
        if (value === "") {
          return true;
        }
        try {
          const url = new URL(value);
          return url.protocol === "https:" && url.hostname === STORE_HOSTS[id];
        } catch {
          return false;
        }
      },
      {
        message: `must be empty ("") or a page on https://${STORE_HOSTS[id]}/`,
      }
    );
}

export const StoresFileSchema = z.strictObject({
  steam: storeUrl("steam"),
  google_play: storeUrl("google_play"),
  app_store: storeUrl("app_store"),
});

/** Validates the content of `stores.json`; empty entries become `null`. Throws a readable error. */
export function parseStoresFile(data: unknown): StoreLinks {
  const result = StoresFileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `apps/web/content/stores.json is invalid:\n${z.prettifyError(result.error)}`
    );
  }
  const links = result.data;
  return {
    app_store: links.app_store || null,
    google_play: links.google_play || null,
    steam: links.steam || null,
  };
}

const LINKS = parseStoresFile(file);

/** Store pages as configured (all `null` before the stores list Soulwick). */
export function storeLinks(): StoreLinks {
  return LINKS;
}

/** Steam page for the wishlist button before the release, `null` while there is none. */
export function steamStoreUrl(): string | null {
  return LINKS.steam;
}
