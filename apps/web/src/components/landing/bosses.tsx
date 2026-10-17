import { useTranslations } from "next-intl";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";
import { WishCycle } from "./wish-cycle";

/**
 * Shape that rises from the fire for each example wish, drawn as a black silhouette with a dream
 * glow: the real boss is built by the AI, the page only hints at it. Scale factor relative to the
 * 64 px boss frames (the chicken is a 16 px sprite).
 */
const SHAPES: { id: SpriteId; factor: number }[] = [
  { id: "ember_golem_idle_4f", factor: 1 },
  { id: "slime_queen_idle_4f", factor: 1 },
  { id: "bone_king_idle_4f", factor: 1 },
  { id: "chicken_idle_4f", factor: 4 },
];

/**
 * "Wish for a boss" (D-179, part of the release): beat a boss, describe your nightmare at the
 * campfire, fight it a few rooms later. The machine on the right shows invented examples only
 * (no real persons, KONZEPT_KI_BOSS §9); the button brings the next one.
 */
export function Bosses() {
  const t = useTranslations("landing");
  const steps = t.raw("bosses.steps") as [string, string][];
  const examples = t.raw("bosses.examples") as [string, string, string][];

  return (
    <section aria-labelledby="bosses-title" className="bosses" id="bosse">
      <div className="container-site bosses-grid">
        <div className="flex flex-col gap-8">
          <SectionIntro
            id="bosses-title"
            text={t("bosses.lead")}
            title={t("bosses.title")}
          />
          <ol className="bosses-steps">
            {steps.map(([title, text], i) => (
              <li key={title}>
                <span aria-hidden="true" className="bosses-step-num">
                  {i + 1}
                </span>
                <span className="flex flex-col gap-1">
                  <strong className="bosses-step-title">{title}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="wish-machine">
          <WishCycle
            anotherLabel={t("bosses.another")}
            note={t("bosses.examplesNote")}
          >
            {examples.map(([wish, name, line], i) => {
              const shape = SHAPES[i % SHAPES.length] ?? SHAPES[0];
              return (
                <div className="wish-example" key={name}>
                  <figure className="wish-slip">
                    <figcaption className="wish-label">
                      {t("bosses.wishLabel")}
                    </figcaption>
                    <blockquote className="wish-text">
                      <p>{wish}</p>
                    </blockquote>
                  </figure>
                  <div className="wish-stage">
                    <span aria-hidden="true" className="wish-shape">
                      <Sprite
                        id={shape?.id ?? "bone_king_idle_4f"}
                        scale={`calc(var(--wish-s) * ${shape?.factor ?? 1})`}
                      />
                    </span>
                    <span aria-hidden="true" className="wish-fire">
                      <Sprite id="brazier_4f" scale="var(--wish-s)" />
                    </span>
                    <p className="wish-boss">
                      <span className="wish-label">
                        {t("bosses.bossLabel")}
                      </span>
                      <strong className="wish-boss-name">{name}</strong>
                      <span className="wish-boss-line">{line}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </WishCycle>
        </div>
      </div>
    </section>
  );
}
