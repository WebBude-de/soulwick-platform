import { useTranslations } from "next-intl";
import { Chicken } from "@/components/fun/chicken";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import { WickButton } from "@/components/wick/wick-button";
import type { WickArt } from "@/lib/brand";

interface MeetWickProps {
  art: WickArt;
}

/**
 * "Meet Wick" (D-175): your companion, a small living candle, and the chicken, both clickable,
 * plus the outfits (looks only, never power, D-176). Wick is drawn as a placeholder until
 * `brand/wick/*` exists; the delivered art replaces it automatically.
 */
export function MeetWick({ art }: MeetWickProps) {
  const t = useTranslations("landing");

  return (
    <section aria-labelledby="wick-title" className="meet-wick" id="wick">
      <div className="container-site meet-wick-grid">
        <div className="meet-wick-stage">
          <span aria-hidden="true" className="meet-wick-light" />
          <span className="meet-wick-figure wick-glow">
            <WickButton
              heroSrc={art.hero}
              scale="var(--wick-s)"
              src={art.idle}
            />
            <span aria-hidden="true" className="wick-sparks">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
          <span className="meet-wick-chicken">
            <Chicken idle scale={4} />
          </span>
          <p className="meet-wick-try">
            <span className="hint-pointer">{t("wick.tryPointer")}</span>
            <span className="hint-touch">{t("wick.tryTouch")}</span>
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <SectionIntro
            id="wick-title"
            text={t("wick.lead")}
            title={t("wick.title")}
          />
          <p className="meet-wick-text">{t("wick.text")}</p>
          <div className="meet-wick-outfits">
            <Sprite id="icon_treasury" scale={2} />
            <p className="flex flex-col gap-1">
              <strong className="meet-wick-outfits-title">
                {t("wick.outfitsTitle")}
              </strong>
              <span>{t("wick.outfitsText")}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
