import Image from "next/image";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { Chicken } from "@/components/fun/chicken";
import { Chip } from "@/components/ui/chip";
import { PixelButton } from "@/components/ui/pixel-button";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

interface HeroProps {
  /** `/brand/keyart.webp` when present. */
  keyartSrc: string | null;
  /** False in teaser mode (`LIVE_FEATURES=false`): the second CTA jumps to the biomes instead. */
  live: boolean;
}

const PLATFORM_ICONS: SpriteId[] = ["chip_pc", "chip_mobile", "chip_crossplay"];

/**
 * Walkers on the ground strip (handoff §5.1), back to front: they cross as one procession with
 * fixed pixel gaps, so they never overlap at any width. The shadow only joins in the Konami
 * easter egg.
 */
const WALKERS: { id: SpriteId; className?: string }[] = [
  { id: "shadow_walk_6f", className: "walker-shadow" },
  { id: "golem_walk_6f" },
  { id: "skeleton_walk_6f" },
  { id: "slime_walk_6f" },
  { id: "player_walk_6f" },
];

/**
 * Splits the eyebrow at " · ": the first phrase may wrap at its hyphens on tiny screens, the
 * later ones stay whole, so "Pixel-Art" never breaks at its hyphen.
 */
function eyebrowParts(text: string): string[] {
  const parts = text.split(" · ");
  return parts.map((part, i) => (i < parts.length - 1 ? `${part} ·` : part));
}

export function Hero({ keyartSrc, live }: HeroProps) {
  const t = useTranslations("landing");
  const platforms = t.raw("platforms") as string[];

  return (
    <section aria-labelledby="hero-title" className="hero" id="top">
      <div className="container-site grid items-center gap-12 py-12 lg:grid-cols-[1.08fr_1fr] lg:gap-14 lg:py-16">
        <div className="flex flex-col items-start gap-6">
          <p className="flex items-center gap-3">
            <span aria-hidden="true" className="hero-flame">
              <Sprite id="soul_flame_6f" scale={1} />
            </span>
            <span className="eyebrow min-w-0">
              {eyebrowParts(t("heroEyebrow")).map((part, i) =>
                i === 0 ? (
                  part
                ) : (
                  <Fragment key={part}>
                    {" "}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                )
              )}
            </span>
          </p>
          <h1 className="max-w-xl" id="hero-title">
            {t("heroTitle")}
          </h1>
          <p className="lead max-w-xl">{t("heroText")}</p>
          <div className="flex flex-wrap gap-4 pt-1">
            <a className="btn btn-primary" href="#spiel">
              <Sprite id="icon_sword" scale={1} />
              {t("heroCta1")}
            </a>
            {live ? (
              <PixelButton href="/leaderboards">{t("heroCta2")}</PixelButton>
            ) : (
              <a className="btn" href="#biome">
                {t("heroCta2Teaser")}
              </a>
            )}
          </div>
          <ul className="flex flex-wrap gap-3 pt-2">
            {platforms.map((label, i) => (
              <li key={label}>
                <Chip
                  icon={PLATFORM_ICONS[i] ?? "chip_pc"}
                  status={{ label: t("planned"), icon: "chip_planned" }}
                >
                  {label}
                </Chip>
              </li>
            ))}
          </ul>
          <p className="max-w-lg text-[13px] text-muted leading-relaxed">
            {t("platformNote")}
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-140 px-3 pt-8 lg:px-0">
          <div className="pixel-frame hero-keyart">
            <span className="hero-chicken">
              <Chicken idle />
            </span>
            {keyartSrc ? (
              <Image
                alt={t("keyartAlt")}
                height={1080}
                priority
                src={keyartSrc}
                unoptimized
                width={1920}
              />
            ) : (
              <Image
                alt={t("keyartAlt")}
                height={270}
                priority
                src="/brand/scenes/main_menu.webp"
                unoptimized
                width={480}
              />
            )}
            <div aria-label={t("hudLabel")} className="hero-hud" role="img">
              <span className="flex gap-1">
                <Sprite id="heart_full" scale={1} />
                <Sprite id="heart_full" scale={1} />
                <Sprite id="heart_full" scale={1} />
              </span>
              <span
                className="font-pixel text-[13px] text-soft"
                style={{ fontWeight: 400 }}
              >
                {t("heroHud")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div aria-label={t("walkersLabel")} className="walkers" role="img">
        <div className="walker-train">
          {WALKERS.map((walker) => (
            <span
              className={["walker", walker.className].filter(Boolean).join(" ")}
              key={walker.id}
            >
              <Sprite id={walker.id} scale={2} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
