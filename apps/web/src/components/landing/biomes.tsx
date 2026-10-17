import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { Sprite } from "@/components/ui/sprite";
import type { BiomeId } from "@/lib/brand";
import type { SpriteId } from "@/lib/sprite-manifest";

interface BiomeArt {
  attack: SpriteId;
  boss: SpriteId;
  glow: string;
  id: BiomeId;
  torch: SpriteId;
}

const BIOMES: BiomeArt[] = [
  {
    id: "crypt",
    torch: "torch_4f",
    glow: "#ff8a3c",
    boss: "bone_king_idle_4f",
    attack: "bone_king_attack_4f",
  },
  {
    id: "slime_grotto",
    torch: "torch_green_4f",
    glow: "#5fcd62",
    boss: "slime_queen_idle_4f",
    attack: "slime_queen_attack_4f",
  },
  {
    id: "shadow_realm",
    torch: "torch_purple_4f",
    glow: "#a66ef0",
    boss: "shadow_lord_idle_4f",
    attack: "shadow_lord_attack_4f",
  },
  {
    id: "ember_forge",
    torch: "brazier_4f",
    glow: "#ff8a3c",
    boss: "ember_golem_idle_4f",
    attack: "ember_golem_attack_4f",
  },
];

interface BiomesProps {
  /** `/brand/biome_<id>.webp` per biome when present. */
  scenes: Record<BiomeId, string | null>;
}

/**
 * Four biome windows, deeper from left to right: the biome render with its own torch light and
 * its boss in front. Hover or focus makes the boss attack.
 */
export function Biomes({ scenes }: BiomesProps) {
  const t = useTranslations("landing");
  const biomes = t.raw("descent.biomes") as [string, string, string][];

  return (
    <ol className="biome-row" id="biome">
      {biomes.map(([name, boss, text], i) => {
        const art = (BIOMES[i] ?? BIOMES[0]) as BiomeArt;
        const scene = scenes[art.id];
        return (
          <li
            className="biome group"
            key={art.id}
            style={{ "--glow": art.glow } as CSSProperties}
          >
            <div className="biome-window">
              {scene ? (
                <Image
                  alt=""
                  height={360}
                  src={scene}
                  unoptimized
                  width={640}
                />
              ) : null}
              <span aria-hidden="true" className="biome-torch">
                <Sprite id={art.torch} scale={2} />
              </span>
              <span aria-hidden="true" className="biome-boss">
                <Sprite
                  hoverId={art.attack}
                  hoverTrigger="group"
                  id={art.boss}
                  scale={1}
                />
              </span>
            </div>
            <div className="biome-text">
              <h3 className="biome-name">{name}</h3>
              <p className="biome-bossline">
                {t("descent.bossLabel")}: {boss}
              </p>
              <p className="biome-flavour">{text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
