import type { GameLinks } from "./game";
import type { StoreId, StoreLinks } from "./stores";

/**
 * Where Soulwick can be played and how far each platform is, derived only from the live switch
 * (`LIVE_FEATURES`), the browser game (`GAME_URL`) and the store pages (`content/stores.json`),
 * so nothing on the page goes stale after the release. All platforms come out together
 * (project member, 17.10.2026): before the release every one is "at release".
 */
export const PLATFORM_IDS = ["browser", "steam", "android", "ios"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** Store behind each platform; the browser version needs none. */
const PLATFORM_STORE: Record<Exclude<PlatformId, "browser">, StoreId> = {
  steam: "steam",
  android: "google_play",
  ios: "app_store",
};

/** Order of official badges in one row: Apple requires the App Store badge first. */
const BADGE_ORDER: StoreId[] = ["app_store", "google_play", "steam"];

/** `playable`: there is a link to play or get it; `atRelease`: live functions off; `later`: live, but no link yet. */
export type PlatformStatus = "playable" | "atRelease" | "later";

export interface BadgeImage {
  /** Nominal size of the artwork; only its proportions matter, it is never stretched. */
  height: number;
  src: string;
  width: number;
}

export interface PlatformTile {
  /** Official store badge, shown unmodified instead of the own tile (only with a store page). */
  badge: BadgeImage | null;
  /** Browser game or store page; `null` = not a link. */
  href: string | null;
  id: PlatformId;
  status: PlatformStatus;
  /** Store behind the platform, `null` for the browser. */
  store: StoreId | null;
}

interface PlatformInput {
  /** Official badge file for a store, `null` while it is not in `public/brand/stores/`. */
  badge: (store: StoreId) => BadgeImage | null;
  /** Browser game links (`playLinks()`), `null` while playing is not live. */
  game: GameLinks | null;
  /** `LIVE_FEATURES`. */
  live: boolean;
  stores: StoreLinks;
}

/**
 * One tile per platform. Before the release (live functions off) they are plain "at release"
 * tiles without links or third-party logos, in the order browser, Steam, Android, iOS. Once live,
 * a platform with a link is playable (the stores with their official badge where the file
 * exists, App Store first), one without a link yet says "later".
 */
export function platformTiles({
  live,
  game,
  stores,
  badge,
}: PlatformInput): PlatformTile[] {
  const tiles: PlatformTile[] = PLATFORM_IDS.map((id) => {
    const store = id === "browser" ? null : PLATFORM_STORE[id];
    if (!live) {
      return { id, store, status: "atRelease", href: null, badge: null };
    }
    const href = store ? stores[store] : (game?.play ?? null);
    if (!href) {
      return { id, store, status: "later", href: null, badge: null };
    }
    return {
      id,
      store,
      status: "playable",
      href,
      badge: store ? badge(store) : null,
    };
  });
  const rank = (tile: PlatformTile) =>
    tile.badge && tile.store
      ? BADGE_ORDER.indexOf(tile.store)
      : BADGE_ORDER.length;
  // Stable sort: badges move to the front in Apple's order, the rest keep theirs.
  return tiles.toSorted((a, b) => rank(a) - rank(b));
}
