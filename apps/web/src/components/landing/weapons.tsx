import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

interface WeaponArt {
  fx: "swing" | "arrow" | "explosion";
  roleColor: string;
  rotation: string;
  sprite: SpriteId;
}

const WEAPONS: WeaponArt[] = [
  {
    sprite: "sword",
    rotation: "-20deg",
    roleColor: "text-gold-dark",
    fx: "swing",
  },
  { sprite: "bow", rotation: "0deg", roleColor: "text-gold-dark", fx: "arrow" },
  {
    sprite: "staff",
    rotation: "-40deg",
    roleColor: "text-violet-link",
    fx: "explosion",
  },
];

interface CategoryArt {
  border: string;
  color: string;
  icons: [SpriteId, SpriteId];
}

const CATEGORIES: CategoryArt[] = [
  {
    icons: ["upgrade_strong_attack", "shield_icon"],
    color: "text-attr",
    border: "border-l-attr",
  },
  {
    icons: ["upgrade_wide_swing", "upgrade_double_shot"],
    color: "text-mech",
    border: "border-l-mech",
  },
  {
    icons: ["upgrade_big_explosion", "upgrade_heal_on_kill"],
    color: "text-effect",
    border: "border-l-effect",
  },
];

function WeaponFx({ kind }: { kind: WeaponArt["fx"] }) {
  if (kind === "swing") {
    return (
      <span className="weapon-fx" style={{ left: 40, bottom: -14 }}>
        <Sprite id="sword_swing_4f" scale={3} />
      </span>
    );
  }
  if (kind === "arrow") {
    return (
      <span
        className="weapon-fx weapon-fx-arrow"
        style={{ left: 104, bottom: 44 }}
      >
        <Sprite id="arrow" scale={2} />
      </span>
    );
  }
  return (
    <span className="weapon-fx" style={{ left: 150, bottom: 10 }}>
      <Sprite id="explosion_6f" scale={1} />
    </span>
  );
}

export function Weapons() {
  const t = useTranslations("landing");
  const weapons = t.raw("weapons") as [
    string,
    string,
    string,
    string,
    string,
    string,
  ][];
  const cats = t.raw("upgradeCats") as [string, string][];

  return (
    <section
      aria-labelledby="weapons-title"
      className="bg-bg-deep py-16 md:py-20"
      id="waffen"
    >
      <div className="container-site">
        <SectionIntro
          eyebrow={t("weaponsEyebrow")}
          id="weapons-title"
          text={t("weaponsText")}
          title={t("weaponsTitle")}
        />

        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {weapons.map(([name, role, text, ...stats], i) => {
            const art = (WEAPONS[i] ?? WEAPONS[0]) as WeaponArt;
            return (
              <li
                className="card card-hover flex flex-col gap-4 p-5"
                key={name}
                tabIndex={-1}
              >
                <div className="vitrine weapon-vitrine">
                  <span
                    className="absolute top-2 right-3 font-pixel text-[12px] text-disabled"
                    style={{ fontWeight: 400 }}
                  >
                    <span className="hint-pointer">{t("hoverHint")}</span>
                    <span className="hint-touch">{t("tapHint")}</span>
                  </span>
                  <span className="weapon-stage">
                    <Sprite id="player_idle_4f" scale={2} />
                    <Sprite
                      className="weapon"
                      id={art.sprite}
                      scale={2}
                      style={{ "--rot": art.rotation } as CSSProperties}
                    />
                  </span>
                  <WeaponFx kind={art.fx} />
                </div>
                <div className="flex items-center gap-3">
                  <Sprite id={art.sprite} scale={1} />
                  <div className="flex flex-col">
                    <h3 className="text-[22px] text-gold">{name}</h3>
                    <span
                      className={`font-pixel text-[12px] uppercase tracking-[0.08em] ${art.roleColor}`}
                      style={{ fontWeight: 400 }}
                    >
                      {role}
                    </span>
                  </div>
                </div>
                <p className="text-[14px] text-soft leading-[1.55]">{text}</p>
                <ul
                  className="mt-auto flex flex-wrap gap-x-5 gap-y-1 border-line border-t-2 pt-3 font-pixel text-[13px] text-muted"
                  style={{ fontWeight: 400 }}
                >
                  {stats.map((stat) => (
                    <li key={stat}>{stat}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>

        <ul className="mt-6 grid gap-5 md:grid-cols-3">
          {cats.map(([name, text], i) => {
            const art = (CATEGORIES[i] ?? CATEGORIES[0]) as CategoryArt;
            return (
              <li
                className={`card card-deep upgrade-card flex items-start gap-4 px-5 py-4 ${art.border}`}
                key={name}
              >
                <span className="flex gap-2 pt-1">
                  <Sprite id={art.icons[0]} scale={2} />
                  <Sprite id={art.icons[1]} scale={2} />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className={`text-[18px] ${art.color}`}>{name}</h3>
                  <p className="text-[14px] text-soft leading-[1.55]">{text}</p>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-[13px] text-muted">{t("upgradesNote")}</p>
      </div>
    </section>
  );
}
