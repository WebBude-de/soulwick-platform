import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { Chicken } from "@/components/fun/chicken";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

const ROW_ICONS: SpriteId[] = [
  "icon_sword",
  "gold_icon",
  "trophy_icon",
  "icon_leaderboard",
  "heart_full",
];

/** Living NPCs and props placed in percent of the 480×270 scene (x, y = feet). */
const NPCS: {
  id: SpriteId;
  x: number;
  y: number;
  x2?: number;
  motion?: "walk" | "peck";
}[] = [
  { id: "smith_idle_4f", x: 24, y: 37 },
  { id: "villager_1_walk_6f", x: 18, y: 46, x2: 72, motion: "walk" },
  { id: "chicken_walk_4f", x: 58, y: 66, motion: "peck" },
  { id: "cat_idle_4f", x: 38, y: 84 },
  { id: "lamp_post_4f", x: 44, y: 48 },
  { id: "well_4f", x: 64, y: 63 },
];

const css = (vars: Record<string, number | string>) => vars as CSSProperties;

interface VillageProps {
  sceneSrc: string | null;
}

export function Village({ sceneSrc }: VillageProps) {
  const t = useTranslations("landing");
  const rows = t.raw("villageList") as [string, string, string][];

  return (
    <section
      aria-labelledby="village-title"
      className="bg-bg-deep py-16 md:py-20"
      id="dorf"
    >
      <div className="container-site grid items-start gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
        <div className="flex flex-col gap-8">
          <SectionIntro
            eyebrow={t("villageEyebrow")}
            id="village-title"
            text={t("villageText")}
            title={t("villageTitle")}
          />
          <ul className="flex flex-col gap-3">
            {rows.map(([name, status, text], i) => (
              <li className="card card-deep village-row" key={name}>
                <Sprite
                  className="mt-0.5"
                  id={ROW_ICONS[i] ?? "icon_sword"}
                  scale={2}
                />
                <div className="flex flex-col gap-0.5">
                  <p className="flex items-baseline gap-3">
                    <span className="font-pixel text-[16px] text-gold">
                      {name}
                    </span>
                    {status ? (
                      <span
                        className="font-pixel text-[12px] text-disabled"
                        style={{ fontWeight: 400 }}
                      >
                        {status}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[14px] text-soft leading-[1.55]">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-3 pt-3 lg:sticky lg:top-24">
          <div className="pixel-frame">
            <div className="village-scene">
              {sceneSrc ? (
                <Image
                  alt={t("villageSceneAlt")}
                  height={270}
                  src={sceneSrc}
                  unoptimized
                  width={480}
                />
              ) : (
                <div className="h-full w-full bg-grass" />
              )}
              {NPCS.map((npc) => (
                <span
                  aria-hidden="true"
                  className={[
                    "village-npc",
                    npc.motion === "walk" ? "village-walker" : "",
                    npc.motion === "peck" ? "village-peck" : "",
                  ].join(" ")}
                  key={`${npc.id}-${npc.x}`}
                  style={css({
                    "--x": npc.x,
                    "--y": npc.y,
                    "--x2": npc.x2 ?? npc.x,
                  })}
                >
                  {npc.id === "chicken_walk_4f" ? (
                    <Chicken scale={1} />
                  ) : (
                    <Sprite id={npc.id} scale={1} />
                  )}
                </span>
              ))}
              <p className="village-caption">{t("villageCaption")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
