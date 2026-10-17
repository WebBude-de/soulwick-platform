import { useTranslations } from "next-intl";
import { PixelButton } from "@/components/ui/pixel-button";
import { Sprite } from "@/components/ui/sprite";

export default function LocaleNotFound() {
  const t = useTranslations("common.notFound");

  return (
    <section
      aria-labelledby="not-found-title"
      className="container-site flex flex-col items-center gap-8 py-24 text-center"
    >
      <div className="group relative flex h-32 w-32 items-end justify-center">
        <div
          aria-hidden="true"
          className="absolute bottom-3 h-4 w-24 rounded-[50%] bg-outline/70"
        />
        <Sprite
          alt={t("spriteAlt")}
          className="relative"
          hoverId="player_revive_4f"
          hoverLoop={false}
          hoverTrigger="group"
          id="player_death_6f"
          scale={3}
        />
      </div>
      <div className="flex flex-col gap-3">
        <p className="font-pixel text-disabled text-lg">404</p>
        <h1 className="text-3xl text-gold sm:text-4xl" id="not-found-title">
          {t("title")}
        </h1>
        <p className="max-w-md text-lg text-soft">{t("text")}</p>
      </div>
      <PixelButton href="/" variant="primary">
        {t("back")}
      </PixelButton>
    </section>
  );
}
