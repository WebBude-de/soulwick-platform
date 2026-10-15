import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import type { BiomeId } from "@/lib/brand";
import type { SpriteId } from "@/lib/sprite-manifest";

interface BiomeArt {
  glow: string;
  id: BiomeId;
  portrait: SpriteId;
  rangeColor: string;
  torch: SpriteId;
}

const BIOMES: BiomeArt[] = [
  {
    id: "crypt",
    torch: "torch_4f",
    glow: "#ff8a3c",
    portrait: "bone_king_portrait",
    rangeColor: "text-line-lighter",
  },
  {
    id: "slime_grotto",
    torch: "torch_green_4f",
    glow: "#5fcd62",
    portrait: "slime_queen_portrait",
    rangeColor: "text-mech",
  },
  {
    id: "shadow_realm",
    torch: "torch_purple_4f",
    glow: "#a66ef0",
    portrait: "shadow_lord_portrait",
    rangeColor: "text-violet-link",
  },
  {
    id: "ember_forge",
    torch: "brazier_4f",
    glow: "#ff8a3c",
    portrait: "ember_golem_portrait",
    rangeColor: "text-effect",
  },
];

interface BiomesProps {
  /** `/brand/biome_<id>.webp` per biome when present. */
  scenes: Record<BiomeId, string | null>;
}

export function Biomes({ scenes }: BiomesProps) {
  const t = useTranslations("landing");
  const biomes = t.raw("biomes") as [string, string, string, string][];

  return (
    <section
      aria-labelledby="biomes-title"
      className="bg-bg py-16 md:py-20"
      id="biome"
    >
      <div className="container-site">
        <SectionIntro
          eyebrow={t("biomesEyebrow")}
          id="biomes-title"
          text={t("biomesText")}
          title={t("biomesTitle")}
        />

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {biomes.map(([name, range, boss, text], i) => {
            const art = (BIOMES[i] ?? BIOMES[0]) as BiomeArt;
            const scene = scenes[art.id];
            return (
              <li
                className="biome-card card flex flex-col overflow-hidden"
                key={art.id}
              >
                <div className="biome-scene">
                  {scene ? (
                    <Image
                      alt=""
                      height={360}
                      src={scene}
                      unoptimized
                      width={640}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="biome-torch"
                    style={{ "--glow": art.glow } as CSSProperties}
                  >
                    <Sprite className="relative" id={art.torch} scale={2} />
                  </span>
                  <span className="biome-plaque">
                    <Sprite id={art.portrait} scale={1} />
                    <span className="flex flex-col">
                      <span className="text-[11px] text-muted uppercase tracking-[0.08em]">
                        {t("bossLabel")}
                      </span>
                      <span
                        className="font-pixel text-[14px] text-text"
                        style={{ fontWeight: 400 }}
                      >
                        {boss}
                      </span>
                    </span>
                  </span>
                </div>
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3 className="text-[22px] text-gold">{name}</h3>
                    <span
                      className={`font-pixel text-[13px] ${art.rangeColor}`}
                      style={{ fontWeight: 400 }}
                    >
                      {range}
                    </span>
                  </div>
                  <p className="text-[14px] text-soft leading-[1.55]">{text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
