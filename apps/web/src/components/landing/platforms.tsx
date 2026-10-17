import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { Sprite } from "@/components/ui/sprite";
import type { PlatformId, PlatformTile } from "@/lib/platforms";
import type { StoreId } from "@/lib/stores";

/** Our own device drawings; store and platform logos are never redrawn. */
const ICONS: Record<PlatformId, ReactNode> = {
  browser: <PixelIcon name="browser" size={32} />,
  steam: <Sprite id="chip_pc" scale={2} />,
  android: <Sprite id="chip_mobile" scale={2} />,
  ios: <PixelIcon name="tablet" size={32} />,
};

const NAME_KEYS = {
  browser: "hero.platform.browser",
  steam: "hero.platform.steam",
  android: "hero.platform.android",
  ios: "hero.platform.ios",
} as const satisfies Record<PlatformId, string>;

const STATUS_KEYS = {
  playable: "status.playable",
  atRelease: "status.atRelease",
  later: "status.later",
} as const;

const BADGE_ALT_KEYS = {
  app_store: "hero.badgeAlt.app_store",
  google_play: "hero.badgeAlt.google_play",
  steam: "hero.badgeAlt.steam",
} as const satisfies Record<StoreId, string>;

const LEGAL_KEYS = {
  app_store: "hero.storeLegal.app_store",
  google_play: "hero.storeLegal.google_play",
  steam: "hero.storeLegal.steam",
} as const satisfies Record<StoreId, string>;

function TileBody({ tile }: { tile: PlatformTile }) {
  const t = useTranslations("landing");
  return (
    <>
      <span aria-hidden="true" className="platform-icon">
        {ICONS[tile.id]}
      </span>
      <span className="platform-text">
        <span className="platform-name">{t(NAME_KEYS[tile.id])}</span>
        <span className="platform-state">
          <span aria-hidden="true" className="platform-light" />
          {t(STATUS_KEYS[tile.status])}
        </span>
      </span>
    </>
  );
}

/**
 * Where Soulwick runs (hero). Before the release: our own pixel tiles, "Browser", "PC · Steam",
 * "Android", "iPhone & iPad", each "at release", no links, no third-party logos. Once live, a
 * store page with its official badge file shows that badge unmodified as a link, App Store first,
 * Google Play at least as large, each in its own pixel frame with the store's legal notice
 * below; platforms without a badge file keep the own tile (as a link when there is one).
 * Status by light (KONZEPT_WEB §2): green = playable, warm = at release, quiet = later.
 */
export function Platforms({ tiles }: { tiles: PlatformTile[] }) {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const badges = tiles.filter((tile) => tile.badge && tile.href && tile.store);
  const own = tiles.filter((tile) => !badges.includes(tile));

  return (
    <div className="platforms">
      {badges.length > 0 ? (
        <ul aria-label={t("hero.storesLabel")} className="store-badges">
          {badges.map((tile) =>
            tile.badge && tile.href && tile.store ? (
              <li className="store-badge-frame" key={tile.id}>
                <a
                  className="store-badge"
                  data-store={tile.store}
                  href={tile.href}
                  rel="noopener"
                  target="_blank"
                >
                  {/* biome-ignore lint/performance/noImgElement: official badge, shown exactly as delivered. */}
                  <img
                    alt={t(BADGE_ALT_KEYS[tile.store])}
                    className="store-badge-img"
                    height={tile.badge.height}
                    src={tile.badge.src}
                    width={tile.badge.width}
                  />
                  <span className="sr-only"> {tc("footer.newTab")}</span>
                </a>
              </li>
            ) : null
          )}
        </ul>
      ) : null}
      {own.length > 0 ? (
        <ul aria-label={t("hero.platformsLabel")} className="platform-tiles">
          {own.map((tile) => (
            <li key={tile.id}>
              {tile.href ? (
                <a
                  className="platform platform-link"
                  data-status={tile.status}
                  href={tile.href}
                  {...(tile.store
                    ? { rel: "noopener", target: "_blank" }
                    : undefined)}
                >
                  <TileBody tile={tile} />
                  {tile.store ? (
                    <span className="sr-only"> {tc("footer.newTab")}</span>
                  ) : null}
                </a>
              ) : (
                <span className="platform" data-status={tile.status}>
                  <TileBody tile={tile} />
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {badges.length > 0 ? (
        <p className="store-legal">
          {badges
            .flatMap((tile) =>
              tile.store
                ? [
                    t(LEGAL_KEYS[tile.store], {
                      year: new Date().getFullYear(),
                    }),
                  ]
                : []
            )
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
}
