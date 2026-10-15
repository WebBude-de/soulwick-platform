import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { MusicControl } from "@/components/ui/music-control";
import { MusicToggle } from "@/components/ui/music-toggle";
import { PixelButton } from "@/components/ui/pixel-button";
import { Sprite } from "@/components/ui/sprite";
import { VolumeSlider } from "@/components/ui/volume-slider";
import { liveFeaturesEnabled } from "@/lib/features";
import { HomeLink } from "./home-link";
import { MobileMenu } from "./mobile-menu";
import { type NavLink, visibleNavLinks } from "./nav-links";

/**
 * Sticky navbar (handoff §3, row 0): logo, anchor links, music with volume, language segment,
 * CTA. Below `xl` the links, language and music move into a burger menu so the bar stays one
 * short row on phones and tablets. In teaser mode (`LIVE_FEATURES=false`) the leaderboards link
 * is dropped and the CTA leads into the game section.
 */
export function SiteHeader() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const live = liveFeaturesEnabled();
  const links = visibleNavLinks(t.raw("navLinks") as NavLink[], live);

  return (
    <header className="sticky top-0 z-40 border-line border-b-2 bg-[rgb(21_19_31/0.94)] backdrop-blur-sm">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-gold focus:px-3 focus:py-2 focus:text-ink"
        href="#inhalt"
      >
        {tc("skipToContent")}
      </a>
      <div className="container-site flex min-h-16 items-center gap-3 py-2 xl:grid xl:grid-cols-[auto_1fr_auto] xl:gap-x-6">
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
          className="hidden min-w-0 xl:flex xl:justify-start"
        >
          <ul className="flex gap-1 whitespace-nowrap">
            {links.map(([label, hash]) => (
              <li key={hash}>
                <a
                  className="nav-link inline-flex min-h-10 items-center px-2.5 font-medium text-[15px] text-soft transition-colors hover:text-gold"
                  href={`/${hash}`}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center justify-end gap-2 sm:gap-3">
          <span className="hidden xl:block">
            <MusicControl />
          </span>
          <LanguageSwitch className="hidden xl:block" />
          {live ? (
            <PixelButton href="/leaderboards" size="sm" variant="primary">
              <span className="header-cta-icon">
                <Sprite id="trophy_icon" scale={1} />
              </span>
              {t("navCta")}
            </PixelButton>
          ) : (
            <a className="btn btn-primary btn-sm" href="/#spiel">
              <span className="header-cta-icon">
                <Sprite id="icon_sword" scale={1} />
              </span>
              {t("navCtaTeaser")}
            </a>
          )}
          <MobileMenu label={tc("menu.label")}>
            <nav aria-label={t("navLabel")}>
              <ul className="menu-links">
                {links.map(([label, hash]) => (
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
