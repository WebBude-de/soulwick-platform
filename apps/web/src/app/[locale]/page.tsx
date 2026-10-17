import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Bosses } from "@/components/landing/bosses";
import { Coop } from "@/components/landing/coop";
import { Descent } from "@/components/landing/descent";
import { Faq } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { LeaderboardTeaser } from "@/components/landing/leaderboard-teaser";
import { NewsTeaser } from "@/components/landing/news-teaser";
import { OpenSourceStrip } from "@/components/landing/open-source-strip";
import { Roadmap } from "@/components/landing/roadmap";
import { Village } from "@/components/landing/village";
import { MeetWick } from "@/components/landing/wick";
import type { Locale } from "@/i18n/locale";
import { brand } from "@/lib/brand";
import { liveFeaturesEnabled } from "@/lib/features";
import { playLinks } from "@/lib/game";
import { platformTiles } from "@/lib/platforms";
import { steamStoreUrl, storeLinks } from "@/lib/stores";
import "@/components/landing/landing.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return {
    title: { absolute: t("meta.title") },
    description: t("meta.description"),
    alternates: { canonical: "/" },
  };
}

/** Per request: `LIVE_FEATURES` and `GAME_URL` are read at runtime, not baked into the build. */
export const dynamic = "force-dynamic";

/**
 * The landing page describes Soulwick as it is at release (D-173, D-174, D-179): friends first,
 * then the wish bosses, Wick, the dungeon, the cozy village, guilds and boards, then what comes
 * after the release, the latest news and short answers. `LIVE_FEATURES` only switches the live
 * functions (play, install, live boards); every description stays the same. Dark sections carry
 * one warm light each; the village is the only daylight.
 */
export default async function LandingPage() {
  const locale = (await getLocale()) as Locale;
  const live = liveFeaturesEnabled();
  const play = playLinks();
  const wick = brand.wick();
  const platforms = platformTiles({
    live,
    game: play,
    stores: storeLinks(),
    badge: (store) => brand.storeBadge(store, locale),
  });

  return (
    <>
      <Hero
        platforms={platforms}
        play={play}
        steamUrl={steamStoreUrl()}
        wickSrc={wick.idle}
      />
      <Coop wickSrc={wick.idle} />
      <Bosses />
      <MeetWick art={wick} />
      <Descent
        scenes={{
          crypt: brand.biome("crypt"),
          slime_grotto: brand.biome("slime_grotto"),
          shadow_realm: brand.biome("shadow_realm"),
          ember_forge: brand.biome("ember_forge"),
        }}
      />
      <Village scene={brand.village()} />
      <LeaderboardTeaser live={live} locale={locale} />
      <Roadmap />
      <NewsTeaser locale={locale} />
      <Faq live={live} />
      <OpenSourceStrip />
    </>
  );
}
