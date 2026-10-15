import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { Chip } from "@/components/ui/chip";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";
import { sprites } from "@/lib/sprite-manifest";

/** Co-op player colours (HANDOUT: P1 blue is the original sprite, P2–P4 tinted via mask). */
const TINTS = [null, "#e0463a", "#5fcd62", "#a66ef0"];

const GUILD_CHIP_ICONS: SpriteId[] = [
  "icon_treasury",
  "icon_sword",
  "icon_leaderboard",
];

function TintedPlayer({ tint, index }: { tint: string | null; index: number }) {
  const mask = sprites.player_tint_mask_idle_4f;
  const idle = sprites.player_idle_4f;
  return (
    <span className="coop-player" style={{ "--i": index } as CSSProperties}>
      <span className="relative inline-block">
        <Sprite id="player_idle_4f" scale={2} />
        {tint ? (
          <span
            aria-hidden="true"
            className="coop-tint"
            style={
              {
                "--tint": tint,
                "--mask": `url("${mask.src}")`,
                "--fw": mask.width,
                "--fh": mask.height,
                "--frames": mask.frames,
                "--dur": `${(idle.frames / idle.fps).toFixed(3)}s`,
              } as CSSProperties
            }
          />
        ) : null}
      </span>
    </span>
  );
}

export function Coop() {
  const t = useTranslations("landing");
  const chips = t.raw("guildChips") as string[];

  return (
    <section
      aria-labelledby="coop-title"
      className="bg-bg py-16 md:py-20"
      id="koop"
    >
      <div className="container-site">
        <SectionIntro
          aside={
            <Chip caps icon="chip_planned">
              {t("planned")}
            </Chip>
          }
          eyebrow={t("coopEyebrow")}
          id="coop-title"
          text={t("coopText")}
          title={t("coopTitle")}
        />

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <article className="card flex flex-col gap-4 p-5">
            <div
              aria-label={t("coopVitrineAlt")}
              className="vitrine coop-vitrine"
              role="img"
            >
              {TINTS.map((tint, i) => (
                <TintedPlayer index={i} key={tint ?? "p1"} tint={tint} />
              ))}
              <span
                className="coop-badge chip"
                style={{ minHeight: 26, fontSize: 12 }}
              >
                <Sprite id="icon_host" scale={1} />
                {t("coopHost")}
              </span>
            </div>
            <h3 className="text-[20px] text-gold">{t("coopCardTitle")}</h3>
            <p className="text-[14px] text-soft leading-[1.55]">
              {t("coopCardText")}
            </p>
          </article>

          <article className="card flex flex-col gap-4 p-5">
            <div
              aria-label={t("guildVitrineAlt")}
              className="vitrine vitrine-dark coop-vitrine flex items-center justify-between px-5"
              role="img"
            >
              <Image
                alt=""
                className="h-12 w-auto"
                height={48}
                src={sprites.guild_emblems.src}
                unoptimized
                width={384}
              />
              <Sprite className="-mb-3" id="guild_hall" scale={1} />
            </div>
            <h3 className="text-[20px] text-gold">{t("guildCardTitle")}</h3>
            <p className="text-[14px] text-soft leading-[1.55]">
              {t("guildCardText")}
            </p>
            <ul className="flex flex-wrap gap-3 pt-1">
              {chips.map((label, i) => (
                <li key={label}>
                  <Chip icon={GUILD_CHIP_ICONS[i] ?? "icon_treasury"}>
                    {label}
                  </Chip>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
