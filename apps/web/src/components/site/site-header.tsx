import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { MusicToggle } from "@/components/ui/music-toggle";
import { PixelButton } from "@/components/ui/pixel-button";
import { Sprite } from "@/components/ui/sprite";
import { liveFeaturesEnabled } from "@/lib/features";
import { HomeLink } from "./home-link";
import { type NavLink, visibleNavLinks } from "./nav-links";

/**
 * Sticky navbar (handoff §3, row 0): logo, anchor links, language segment, CTA. In teaser mode
 * (`LIVE_FEATURES=false`) the leaderboards link is dropped and the CTA leads into the game section.
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
      <div className="container-site grid min-h-16 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 py-2 md:grid-cols-[auto_1fr_auto] md:gap-x-6">
        <HomeLink
          aria-label={tc("siteName")}
          className="col-start-1 row-start-1 flex items-center py-1"
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

        <div className="col-span-2 row-start-2 flex items-center gap-2 md:col-span-1 md:col-start-2 md:row-start-1 md:justify-center">
          <nav
            aria-label={t("navLabel")}
            className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
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
          {/* On phones the music toggle sits at the end of the link row to keep the first row short. */}
          <span className="sm:hidden">
            <MusicToggle className="px-1" />
          </span>
        </div>

        <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:gap-3 md:col-start-3">
          <span className="hidden sm:block">
            <MusicToggle className="px-1" />
          </span>
          <LanguageSwitch />
          {live ? (
            <PixelButton href="/leaderboards" size="sm" variant="primary">
              <Sprite id="trophy_icon" scale={1} />
              {t("navCta")}
            </PixelButton>
          ) : (
            <a className="btn btn-primary btn-sm" href="/#spiel">
              <Sprite id="icon_sword" scale={1} />
              {t("navCtaTeaser")}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
