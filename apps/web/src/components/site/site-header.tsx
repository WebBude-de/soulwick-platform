import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { MusicControl } from "@/components/ui/music-control";
import { MusicToggle } from "@/components/ui/music-toggle";
import { PixelButton } from "@/components/ui/pixel-button";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { Sprite } from "@/components/ui/sprite";
import { VolumeSlider } from "@/components/ui/volume-slider";
import { liveFeaturesEnabled } from "@/lib/features";
import { playLinks } from "@/lib/game";
import { steamStoreUrl } from "@/lib/stores";
import { HomeLink } from "./home-link";
import { MobileMenu } from "./mobile-menu";
import type { NavLink } from "./nav-links";
import { PlayButtons } from "./play-buttons";

/**
 * Sticky navbar: logo, links, music with volume, language segment, CTA. Below `xl` the links,
 * language and music move into a burger menu so the bar stays one short row on phones and
 * tablets. From `xl` the bar is wider than the page content (`container-header`) so the German
 * links, the controls and the longest CTA fit one row; the controls never shrink, and should the
 * links ever run out of room they wrap to a second row instead of sliding under the controls. The CTA is "Play" while playing is live (`playLinks`: `LIVE_FEATURES` and
 * `GAME_URL`), else the leaderboards (`LIVE_FEATURES`), else the Steam wishlist once
 * `content/stores.json` has the store page, else the news. Never a play link with the live
 * functions off; with them on the burger menu opens with its play and install buttons.
 */
export function SiteHeader() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const live = liveFeaturesEnabled();
  const links = t.raw("navLinks") as NavLink[];
  /** Pages that only fit the burger menu and the footer, not the desktop row. */
  const menuLinks = [...links, ...(t.raw("navExtra") as NavLink[])];
  const game = playLinks();
  const steam = steamStoreUrl();

  return (
    <header className="sticky top-0 z-40 border-line border-b-2 bg-[rgb(21_19_31/0.94)] backdrop-blur-sm">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-gold focus:px-3 focus:py-2 focus:text-ink"
        href="#inhalt"
      >
        {tc("skipToContent")}
      </a>
      <div className="container-header flex min-h-16 items-center gap-3 py-2 xl:gap-x-6">
        <HomeLink
          aria-label={tc("siteName")}
          className="flex items-center py-1"
        >
          {/* biome-ignore lint/performance/noImgElement: crisp-edges SVG wordmark, no optimisation needed. */}
          <img
            alt=""
            className="h-8 w-auto sm:h-9"
            height={36}
            src="/brand/logo.svg"
            width={120}
          />
        </HomeLink>

        <nav
          aria-label={t("navLabel")}
          className="hidden min-w-0 flex-1 xl:block"
        >
          <ul className="nav-row">
            {links.map(([label, hash]) => (
              <li key={hash}>
                <a
                  className="nav-link inline-flex min-h-10 items-center whitespace-nowrap px-2 font-medium text-[15px] text-soft transition-colors hover:text-gold 2xl:px-2.5"
                  href={`/${hash}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          <span className="hidden xl:block">
            <MusicControl />
          </span>
          <LanguageSwitch className="hidden xl:block" />
          {game ? (
            <a className="btn btn-primary btn-sm" href={game.play}>
              <span className="header-cta-icon">
                <PixelIcon name="play" />
              </span>
              {t("navCtaPlay")}
            </a>
          ) : live ? (
            <PixelButton href="/leaderboards" size="sm" variant="primary">
              <span className="header-cta-icon">
                <Sprite id="trophy_icon" scale={1} />
              </span>
              {t("navCta")}
            </PixelButton>
          ) : steam ? (
            <a
              className="btn btn-primary btn-sm"
              href={steam}
              rel="noopener"
              target="_blank"
            >
              <span className="header-cta-icon">
                <Sprite id="heart_full" scale={1} />
              </span>
              {t("navCtaWishlist")}
              <span className="sr-only"> {tc("footer.newTab")}</span>
            </a>
          ) : (
            <a className="btn btn-primary btn-sm" href="/news">
              <span className="header-cta-icon">
                <Sprite id="torch_4f" scale={1} still />
              </span>
              {t("navCtaNews")}
            </a>
          )}
          <MobileMenu label={tc("menu.label")}>
            {game ? (
              <section aria-label={tc("play.heading")} className="menu-play">
                <PlayButtons links={game} size="sm" />
                <p className="text-[14px] text-muted leading-relaxed">
                  {tc("play.hint")}
                </p>
              </section>
            ) : null}
            <nav aria-label={t("navLabel")}>
              <ul className="menu-links">
                {menuLinks.map(([label, hash]) => (
                  <li key={hash}>
                    <a className="menu-link" href={`/${hash}`}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="menu-tools">
              <div className="menu-tool">
                <span aria-hidden="true" className="menu-tool-label">
                  {tc("language.label")}
                </span>
                <LanguageSwitch touch />
              </div>
              <div className="menu-tool">
                <span aria-hidden="true" className="menu-tool-label">
                  {tc("music.heading")}
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <MusicToggle className="-ml-2" withLabel />
                  <VolumeSlider />
                </div>
              </div>
            </div>
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}
