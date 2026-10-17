import { describe, expect, it, mock } from "bun:test";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The landing sections in both modes of `LIVE_FEATURES`: only the hero's play and install
 * buttons, its platform tiles (`platformTiles`) and the release question of the FAQ depend on
 * it; with the live functions off the hero shows "playable at release" and links nowhere near the
 * game or a store. Every feature section renders without any mode.
 */

// `server-only` throws outside the react-server condition; Next.js resolves it to an empty module.
mock.module("server-only", () => ({}));
const { getMessages } = await import("../src/i18n/messages.ts");
const { Hero } = await import("../src/components/landing/hero.tsx");
const { Coop } = await import("../src/components/landing/coop.tsx");
const { Bosses } = await import("../src/components/landing/bosses.tsx");
const { MeetWick } = await import("../src/components/landing/wick.tsx");
const { Village } = await import("../src/components/landing/village.tsx");
const { Roadmap } = await import("../src/components/landing/roadmap.tsx");
const { Faq } = await import("../src/components/landing/faq.tsx");
const { platformTiles } = await import("../src/lib/platforms.ts");

const GAME = {
  play: "https://game.example.test/",
  install: "https://game.example.test/?install",
};
const NO_WICK = { idle: null, hero: null, withChicken: null };
const APPLE = "https://apps.apple.com/app/soulwick/id123";
const PLAY =
  "https://play.google.com/store/apps/details?id=de.webbude.soulwick";
const STEAM = "https://store.steampowered.com/app/123/Soulwick/";
const STORES = { app_store: APPLE, google_play: PLAY, steam: STEAM };
const NO_STORES = { app_store: null, google_play: null, steam: null };
const BEFORE = platformTiles({
  live: false,
  game: null,
  stores: STORES,
  badge: () => null,
});
const BADGE = { src: "/brand/stores/badge.webp", width: 120, height: 40 };
const TEASER_MARKS = /status-chip|in the works|in Arbeit|geplant/;
const PLATFORM_NAMES = /Android|iOS|iPhone/;

function render(locale: "en" | "de", node: ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={getMessages(locale)}
      timeZone="UTC"
    >
      {node}
    </NextIntlClientProvider>
  );
}

describe("hero", () => {
  it("shows 'playable at release' and no game link with the live functions off", () => {
    const en = render(
      "en",
      <Hero platforms={BEFORE} play={null} steamUrl={null} wickSrc={null} />
    );
    expect(en).toContain("Playable at release");
    expect(en).not.toContain("game.example.test");
    expect(en).not.toContain("Play free in your browser");
    expect(en).toContain('href="#koop"');
    const de = render(
      "de",
      <Hero platforms={BEFORE} play={null} steamUrl={null} wickSrc={null} />
    );
    expect(de).toContain("Zum Release spielbar");
  });

  it("lists every platform 'at release' as an own tile without store links or badges before the release", () => {
    for (const [locale, state] of [
      ["en", "at release"],
      ["de", "zum Release"],
    ] as const) {
      const html = render(
        locale,
        <Hero platforms={BEFORE} play={null} steamUrl={null} wickSrc={null} />
      );
      for (const name of [
        "Browser",
        "PC · Steam",
        "Android",
        "iPhone &amp; iPad",
      ]) {
        expect(html).toContain(name);
      }
      expect(html.split(`>${state}<`).length - 1).toBe(4);
      expect(html).not.toContain(APPLE);
      expect(html).not.toContain(PLAY);
      expect(html).not.toContain("store-badge");
    }
  });

  it("shows official badges as store links once live, App Store first, with the legal notes", () => {
    const html = render(
      "en",
      <Hero
        platforms={platformTiles({
          live: true,
          game: GAME,
          stores: STORES,
          badge: (store) => (store === "steam" ? null : BADGE),
        })}
        play={GAME}
        steamUrl={null}
        wickSrc={null}
      />
    );
    expect(html.indexOf(APPLE)).toBeGreaterThan(-1);
    expect(html.indexOf(APPLE)).toBeLessThan(html.indexOf(PLAY));
    expect(html).toContain('alt="Download on the App Store"');
    expect(html).toContain('alt="Get it on Google Play"');
    expect(html).toContain("trademarks of Google LLC");
    // Steam has no badge file here: its own tile links to the store, without any Steam logo.
    expect(html).toContain(`href="${STEAM}"`);
    expect(html).not.toContain("Valve Corporation");
  });

  it("offers play and install while live", () => {
    const html = render(
      "en",
      <Hero
        platforms={platformTiles({
          live: true,
          game: GAME,
          stores: NO_STORES,
          badge: () => null,
        })}
        play={GAME}
        steamUrl={null}
        wickSrc={null}
      />
    );
    expect(html).toContain(`href="${GAME.play}"`);
    expect(html).toContain('href="https://game.example.test/?install"');
    expect(html).not.toContain("Playable at release");
  });

  it("adds the Steam wishlist once the store page exists", () => {
    const url = "https://store.steampowered.com/app/1";
    const html = render(
      "en",
      <Hero platforms={BEFORE} play={null} steamUrl={url} wickSrc={null} />
    );
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Wishlist on Steam");
  });
});

describe("faq", () => {
  it("asks 'when?' before the release and 'where?' once live", () => {
    expect(render("en", <Faq live={false} />)).toContain(
      "When does Soulwick come out?"
    );
    const live = render("en", <Faq live />);
    expect(live).toContain("Where do I get Soulwick?");
    expect(live).not.toContain("When does Soulwick come out?");
    expect(render("de", <Faq live />)).toContain("Wo bekomme ich Soulwick?");
  });
});

describe("feature sections", () => {
  for (const locale of ["en", "de"] as const) {
    it(`render the release state without status chips (${locale})`, () => {
      const html = render(
        locale,
        <>
          <Coop wickSrc={null} />
          <Bosses />
          <MeetWick art={NO_WICK} />
          <Village scene={null} />
          <Roadmap />
        </>
      );
      expect(html).not.toMatch(TEASER_MARKS);
      expect(html).toContain('id="bosse"');
      // Every platform is there at release: "What's next" names no platform.
      expect(html).not.toMatch(PLATFORM_NAMES);
    });
  }
});
