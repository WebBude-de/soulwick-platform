import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { type ModeSymbol, ModeSymbolIcon } from "@/components/ui/mode-symbol";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

/** Little scenes for the stops of the descent, in the order of `descentStops`. */
const STOP_SCENES: { scene: ReactNode; dark?: boolean }[] = [
  {
    scene: (
      <>
        <Sprite id="player_idle_4f" scale={2} />
        <Sprite flip id="skeleton_walk_6f" scale={2} />
        <Sprite className="-ml-4" flip id="slime_walk_6f" scale={2} />
      </>
    ),
  },
  {
    scene: (
      <>
        <Sprite id="player_walk_6f" scale={2} />
        <Sprite id="villager_1_walk_6f" scale={2} />
        <Sprite className="mb-1" id="chicken_walk_4f" scale={2} />
      </>
    ),
  },
  {
    scene: (
      <>
        <BranchDoor mode="hunt" />
        <BranchDoor mode="flame" />
      </>
    ),
  },
  {
    dark: true,
    scene: (
      <>
        <span className="descent-ladder">
          <Sprite id="ladder_top" scale={2} />
          <Sprite id="ladder" scale={2} />
        </span>
        <Sprite className="descent-jumper" id="player_dash_3f" scale={2} />
      </>
    ),
  },
  {
    scene: (
      <Sprite
        hoverId="bone_king_attack_4f"
        hoverTrigger="group"
        id="bone_king_idle_4f"
        scale={2}
      />
    ),
  },
  {
    scene: (
      <>
        <Sprite id="player_idle_4f" scale={2} />
        <Sprite id="campfire_6f" scale={2} />
      </>
    ),
  },
];

function BranchDoor({ mode }: { mode: ModeSymbol }) {
  return (
    <span className="descent-door">
      <ModeSymbolIcon className="descent-door-symbol" mode={mode} scale={2} />
      <Sprite id="door_frame_crypt" scale={2} />
    </span>
  );
}

/** Mini-game teasers: mode symbol, an animated sprite and one hook line each. */
const MINIGAMES: {
  mode: ModeSymbol;
  sprite: SpriteId;
  extra?: SpriteId;
  scale: number;
}[] = [
  { mode: "flame", sprite: "soul_flame_6f", scale: 2 },
  {
    mode: "escort",
    sprite: "villager_2_walk_6f",
    extra: "chicken_walk_4f",
    scale: 2,
  },
  { mode: "relic", sprite: "relic_skull", extra: "relic_altar", scale: 2 },
  { mode: "souls", sprite: "soul_wisp_4f", extra: "soul_wisp_4f", scale: 3 },
  { mode: "rifts", sprite: "summoning_rift_6f", scale: 2 },
  { mode: "hunt", sprite: "bounty_crown", extra: "escape_hole_4f", scale: 3 },
  {
    mode: "lightfire",
    sprite: "torch_stand_4f",
    extra: "stone_guardian_frozen",
    scale: 2,
  },
  { mode: "collapse", sprite: "crumbling_floor_6f", scale: 2 },
];

const css = (vars: Record<string, string | number>) => vars as CSSProperties;

/**
 * „Der Abstieg“: a teaser of what a run can throw at you, as a zig-zag path down through the
 * dungeon (one hook per stop), followed by a grid of mini-game teasers and the gold rule.
 */
export function Descent() {
  const t = useTranslations("landing");
  const stops = t.raw("descentStops") as [string, string][];
  const games = t.raw("minigames") as [string, string][];

  return (
    <section
      aria-labelledby="descent-title"
      className="descent py-16 md:py-20"
      id="spiel"
    >
      <div className="container-site">
        <SectionIntro
          eyebrow={t("descentEyebrow")}
          id="descent-title"
          text={t("descentText")}
          title={t("descentTitle")}
        />

        <ol className="descent-path mt-12">
          {stops.map(([label, hook], i) => {
            const stop = STOP_SCENES[i];
            return (
              <li
                className="descent-stop group"
                data-side={i % 2 === 0 ? "left" : "right"}
                key={label}
                style={css({ "--i": i })}
              >
                <span aria-hidden="true" className="descent-marker">
                  <Sprite id="torch_4f" scale={1} />
                </span>
                <div className="descent-card card card-hover">
                  <div
                    className={[
                      "descent-scene vitrine",
                      stop?.dark ? "vitrine-dark" : "",
                    ].join(" ")}
                  >
                    {stop?.scene}
                  </div>
                  <div className="flex flex-col gap-1.5 p-4">
                    <p className="eyebrow">{label}</p>
                    <p className="descent-hook">{hook}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-20">
          <h3 className="text-[26px] text-text sm:text-3xl">
            {t("minigamesTitle")}
          </h3>
          <p className="lead mt-3 max-w-2xl">{t("minigamesText")}</p>
          <ul className="minigame-grid mt-8">
            {MINIGAMES.map((game, i) => {
              const [name, hook] = games[i] ?? ["", ""];
              return (
                <li className="minigame card card-hover group" key={game.mode}>
                  <div className="minigame-scene vitrine">
                    <ModeSymbolIcon
                      className="minigame-symbol"
                      mode={game.mode}
                      scale={2}
                    />
                    {game.extra && game.mode === "relic" ? (
                      <span className="minigame-stack">
                        <Sprite id={game.sprite} scale={game.scale} />
                        <Sprite id={game.extra} scale={game.scale} />
                      </span>
                    ) : (
                      <>
                        <Sprite
                          id={game.sprite}
                          scale={game.scale}
                          style={
                            game.mode === "collapse"
                              ? { animationIterationCount: "infinite" }
                              : undefined
                          }
                        />
                        {game.extra ? (
                          <Sprite
                            className={
                              game.mode === "souls"
                                ? "minigame-wisp"
                                : undefined
                            }
                            id={game.extra}
                            scale={
                              game.mode === "hunt" || game.mode === "souls"
                                ? 2
                                : game.scale
                            }
                            style={
                              game.mode === "hunt"
                                ? { animationIterationCount: "infinite" }
                                : undefined
                            }
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 p-3.5">
                    <h4 className="text-[17px] text-gold">{name}</h4>
                    <p className="text-[14px] text-soft leading-snug">{hook}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card card-deep mt-12 flex items-start gap-5 px-6 py-5">
          <Sprite className="mt-0.5" id="gold_coin_4f" scale={2} />
          <p className="text-[15px] text-soft leading-relaxed">
            <strong className="text-gold">{t("goldTitle")}</strong>{" "}
            {t("goldText")}
          </p>
        </div>
      </div>
    </section>
  );
}
