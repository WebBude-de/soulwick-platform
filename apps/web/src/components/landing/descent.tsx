import { useTranslations } from "next-intl";
import { type ModeSymbol, ModeSymbolIcon } from "@/components/ui/mode-symbol";
import { SectionIntro } from "@/components/ui/section-intro";
import type { BiomeId } from "@/lib/brand";
import { Biomes } from "./biomes";

/** Mini-game symbols from the game's doors, in the order of `descent.minigames`. */
const MINIGAMES: ModeSymbol[] = [
  "flame",
  "escort",
  "relic",
  "souls",
  "rifts",
  "hunt",
  "lightfire",
  "collapse",
];

interface DescentProps {
  /** `/brand/biome_<id>.webp` per biome when present. */
  scenes: Record<BiomeId, string | null>;
}

/**
 * "No two descents are alike": the dungeon in one atmospheric pass. Four biomes with their
 * bosses, the mini-games as a compact list, and one line about skill (easy to learn, hard to
 * master). No numbers: the site is a teaser, not a manual.
 */
export function Descent({ scenes }: DescentProps) {
  const t = useTranslations("landing");
  const games = t.raw("descent.minigames") as [string, string][];

  return (
    <section aria-labelledby="descent-title" className="descent" id="spiel">
      <div className="container-site flex flex-col gap-12">
        <SectionIntro
          id="descent-title"
          text={t("descent.lead")}
          title={t("descent.title")}
        />

        <Biomes scenes={scenes} />

        <div className="flex flex-col gap-6">
          <h3 className="descent-subtitle">{t("descent.minigamesTitle")}</h3>
          <ul className="minigames">
            {games.map(([name, hook], i) => (
              <li className="minigame" key={name}>
                <ModeSymbolIcon
                  className="minigame-symbol"
                  mode={MINIGAMES[i] ?? "combat"}
                  scale={2}
                />
                <span className="flex flex-col">
                  <strong className="minigame-name">{name}</strong>
                  <span className="minigame-hook">{hook}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="descent-skill">{t("descent.skill")}</p>
      </div>
    </section>
  );
}
