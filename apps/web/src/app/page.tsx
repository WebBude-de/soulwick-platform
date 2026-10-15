import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Biomes } from "@/components/landing/biomes";
import { Coop } from "@/components/landing/coop";
import { Descent } from "@/components/landing/descent";
import { Hero } from "@/components/landing/hero";
import { LeaderboardTeaser } from "@/components/landing/leaderboard-teaser";
import { Village } from "@/components/landing/village";
import { Weapons } from "@/components/landing/weapons";
import { Divider } from "@/components/ui/divider";
import type { Locale } from "@/i18n/locale";
import { brand, brandAsset } from "@/lib/brand";
import "@/components/landing/landing.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return {
    title: { absolute: t("meta.title") },
    description: t("meta.description"),
    alternates: { canonical: "/" },
  };
}

export default async function LandingPage() {
  const locale = (await getLocale()) as Locale;

  return (
    <>
      <Hero keyartSrc={brand.keyart()} />
      <Descent />
      <Divider />
      <Weapons />
      <Biomes
        scenes={{
          crypt: brand.biome("crypt"),
          slime_grotto: brand.biome("slime_grotto"),
          shadow_realm: brand.biome("shadow_realm"),
          ember_forge: brand.biome("ember_forge"),
        }}
      />
      <Divider />
      <Village sceneSrc={brandAsset("scenes/village.webp")} />
      <Coop />
      <LeaderboardTeaser locale={locale} />
    </>
  );
}
