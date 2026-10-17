import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { Sprite } from "@/components/ui/sprite";
import { WickFigure } from "@/components/wick/wick-figure";
import type { GameLinks } from "@/lib/game";
import type { PlatformTile } from "@/lib/platforms";
import type { SpriteId } from "@/lib/sprite-manifest";
import { FIGURES, Figure } from "./figures";
import { HeroStage } from "./hero-stage";
import { Platforms } from "./platforms";

interface HeroProps {
  /** Where Soulwick runs and how far each platform is (`platformTiles`). */
  platforms: PlatformTile[];
  /** Play and install links (`playLinks`), `null` = "playable at release". */
  play: GameLinks | null;
  /** Steam store page from `content/stores.json` (wishlist before the release), else `null`. */
  steamUrl: string | null;
  /** Delivered Wick strip, `null` = placeholder. */
  wickSrc: string | null;
}

type Spot = [x: number, y: number];

/** The four playable figures (feet in % of the stage), each in their own small light. */
const FRIENDS: Spot[] = [
  [27, 74],
  [42, 82],
  [58, 74],
  [73, 82],
];
/** Light offset above Wick's feet, in art pixels: the middle of the flame. */
const WICK_LIGHT = 20;
/** Wall torches (centre in % of the stage width). */
const TORCHES = [22, 80];
/** What hides in the dark until Wick's light finds it. */
const LURKERS: { id: SpriteId; at: Spot; flip?: boolean }[] = [
  { id: "skeleton_idle_4f", at: [14, 50] },
  { id: "archer_idle_4f", at: [88, 48], flip: true },
  { id: "slime_idle_4f", at: [86, 92], flip: true },
  { id: "chest_closed", at: [11, 90] },
  { id: "bones_1", at: [36, 95] },
  { id: "gold_coin_4f", at: [64, 93] },
  { id: "gold_coin_4f", at: [61, 60] },
  { id: "bones_2", at: [70, 56] },
];
/** Eyes that blink in the far corners and never come closer. */
const EYES: Spot[] = [
  [4, 66],
  [97, 70],
];

const at = ([x, y]: Spot) =>
  ({ "--x": x, "--y": y }) as CSSProperties & Record<string, number>;

/**
 * The light holes cut into the darkness: Wick's (moving), one per friend, one per torch.
 * Rendered once on the server; only `--wx`/`--wy` change while Wick moves.
 */
const HOLES = [
  `radial-gradient(circle var(--lr) at var(--wx) calc(var(--wy) - var(--px) * ${WICK_LIGHT}px), transparent 0 26%, rgb(0 0 0 / 0.55) 58%, #000 100%)`,
  ...FRIENDS.map(
    ([x, y]) =>
      `radial-gradient(circle calc(var(--px) * 24px) at ${x}% calc(${y}% - var(--px) * 14px), transparent 0 30%, #000 100%)`
  ),
  ...TORCHES.map(
    (x) =>
      `radial-gradient(circle calc(var(--px) * 34px) at ${x}% calc(var(--px) * 20px), transparent 0 18%, #000 100%)`
  ),
].join(", ");

/**
 * Walkers on the ground strip under the hero: monsters chase the four figures, who chase Wick,
 * who chases the chicken. Back to front; the shadow only joins in the Konami easter egg.
 */
const CHASERS: { id: SpriteId; className?: string }[] = [
  { id: "shadow_walk_6f", className: "walker-shadow" },
  { id: "golem_walk_6f" },
  { id: "skeleton_walk_6f" },
  { id: "slime_walk_6f" },
];

export function Hero({ play, platforms, steamUrl, wickSrc }: HeroProps) {
  const t = useTranslations("landing");
  const tc = useTranslations("common");

  return (
    <section aria-labelledby="hero-title" className="hero" id="top">
      <HeroStage className="hero-stage">
        <div aria-hidden="true" className="hero-scene">
          <div className="hero-floor" />
          <div className="hero-wall" />
          {LURKERS.map((lurker) => (
            <span
              className="hero-spot"
              key={`${lurker.id}-${lurker.at.join("-")}`}
              style={at(lurker.at)}
            >
              <Sprite flip={lurker.flip} id={lurker.id} />
            </span>
          ))}
          {FRIENDS.map((spot, i) => (
            <span
              className="hero-spot hero-friend"
              key={spot.join("-")}
              style={at(spot)}
            >
              {/* The right pair faces the group, so the four stand together. */}
              <Figure
                flip={i >= 2}
                id={FIGURES[i] ?? "player"}
                scale="var(--px)"
              />
            </span>
          ))}
          <div
            className="hero-dark"
            style={{ "--holes": HOLES } as CSSProperties}
          />
          <div className="hero-warm" />
          {TORCHES.map((x) => (
            <span
              className="hero-torch"
              key={x}
              style={{ "--x": x } as CSSProperties}
            >
              <Sprite id="torch_4f" />
            </span>
          ))}
          {EYES.map((spot) => (
            <span className="hero-eyes" key={spot.join("-")} style={at(spot)} />
          ))}
        </div>
        {/* Outside the faded scene: on wide screens Wick follows the mouse over the headline. */}
        <span aria-hidden="true" className="hero-wick">
          <span className="hero-wick-body wick-glow">
            <WickFigure src={wickSrc} />
          </span>
          <span className="wick-sparks">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
        <p aria-hidden="true" className="hero-hint">
          <span className="hint-pointer">{t("hero.hintPointer")}</span>
          <span className="hint-touch">{t("hero.hintTouch")}</span>
        </p>
      </HeroStage>

      <div className="hero-copy container-site">
        <div className="hero-text">
          <h1 className="hero-title" id="hero-title">
            <span>{t("hero.titleA")}</span> <span>{t("hero.titleB")}</span>
          </h1>
          <p className="lead hero-lead">{t("hero.lead")}</p>

          {play ? (
            <>
              <div className="hero-ctas">
                <a className="btn btn-primary" href={play.play}>
                  <PixelIcon name="play" />
                  {t("hero.play")}
                </a>
                <a className="btn" href="#koop">
                  {t("hero.discover")}
                </a>
              </div>
              <p className="hero-note">
                {t.rich("hero.install", {
                  link: (chunks) => <a href={play.install}>{chunks}</a>,
                })}
              </p>
            </>
          ) : (
            <>
              {/* Live functions are off: a clear state instead of a play button, no dead link. */}
              <p className="hero-release">
                <span aria-hidden="true" className="hero-release-light">
                  <Sprite id="torch_4f" scale={2} />
                </span>
                <span className="flex flex-col gap-1">
                  <strong className="hero-release-title">
                    {t("hero.releaseTitle")}
                  </strong>
                  <span>{t("hero.releaseText")}</span>
                </span>
              </p>
              <div className="hero-ctas">
                {steamUrl ? (
                  <a
                    className="btn btn-primary"
                    href={steamUrl}
                    rel="noopener"
                    target="_blank"
                  >
                    <Sprite id="heart_full" scale={1} />
                    {t("hero.wishlist")}
                    <span className="sr-only"> {tc("footer.newTab")}</span>
                  </a>
                ) : null}
                <a
                  className={steamUrl ? "btn" : "btn btn-primary"}
                  href="#koop"
                >
                  {t("hero.discover")}
                </a>
                {steamUrl ? null : (
                  <a className="btn" href="/news">
                    {t("hero.news")}
                  </a>
                )}
              </div>
            </>
          )}

          <Platforms tiles={platforms} />
          <p className="hero-fine">{t("hero.platformNote")}</p>
        </div>
      </div>

      <div aria-label={t("hero.walkersLabel")} className="walkers" role="img">
        <div className="walker-train">
          {CHASERS.map((walker) => (
            <span
              className={["walker", walker.className].filter(Boolean).join(" ")}
              key={walker.id}
            >
              <Sprite id={walker.id} scale={2} />
            </span>
          ))}
          <span className="walker walker-party">
            {FIGURES.map((id) => (
              <Figure anim="walk" id={id} key={id} scale={2} />
            ))}
          </span>
          <span className="walker walker-wick">
            <WickFigure scale={2} src={wickSrc} />
          </span>
          <span className="walker walker-chicken">
            <Sprite id="chicken_walk_4f" scale={2} />
          </span>
        </div>
      </div>
    </section>
  );
}
