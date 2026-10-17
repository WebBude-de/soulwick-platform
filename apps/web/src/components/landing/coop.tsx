import { useTranslations } from "next-intl";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";
import { WickFigure } from "@/components/wick/wick-figure";
import type { SpriteId } from "@/lib/sprite-manifest";
import { FIGURES, Figure } from "./figures";

const BEAT_ICONS: SpriteId[] = ["teammate_arrow", "icon_host", "icon_revive"];

interface CoopProps {
  wickSrc: string | null;
}

/**
 * "Rush in with your friends": co-op is the heart of Soulwick (D-173), shown as a little lobby
 * (room code, the four playable figures, Wick, the invite link) next to three short beats. Described as it is
 * at release, without a status chip.
 */
export function Coop({ wickSrc }: CoopProps) {
  const t = useTranslations("landing");
  const beats = t.raw("coop.beats") as [string, string][];
  const code = t("coop.code").split("");

  return (
    <section aria-labelledby="coop-title" className="coop" id="koop">
      <div className="container-site coop-grid">
        <div className="flex flex-col gap-8">
          <SectionIntro
            id="coop-title"
            text={t("coop.lead")}
            title={t("coop.title")}
          />
          <ul className="coop-beats">
            {beats.map(([title, text], i) => (
              <li key={title}>
                <span aria-hidden="true" className="coop-beat-icon">
                  <Sprite id={BEAT_ICONS[i] ?? "icon_host"} scale={2} />
                </span>
                <span className="flex flex-col gap-1">
                  <strong className="coop-beat-title">{title}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="coop-note">{t("coop.guilds")}</p>
        </div>

        <div
          aria-label={t("coop.vitrineAlt")}
          className="coop-lobby"
          role="img"
        >
          <div aria-hidden="true" className="coop-code">
            <span className="coop-code-label">{t("coop.codeLabel")}</span>
            <span className="coop-code-tiles">
              {code.map((char, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative letters, may repeat.
                <span className="coop-code-tile" key={i}>
                  {char}
                </span>
              ))}
            </span>
          </div>
          <div aria-hidden="true" className="coop-floor">
            <span className="coop-host chip">
              <Sprite id="icon_host" scale={1} />
              {t("coop.host")}
            </span>
            <span className="coop-wick">
              <span className="coop-wick-float wick-glow">
                <WickFigure scale={2} src={wickSrc} />
              </span>
            </span>
            {FIGURES.map((id) => (
              <span className="coop-friend" key={id}>
                <Figure id={id} scale="var(--coop-s)" />
              </span>
            ))}
          </div>
          <div aria-hidden="true" className="coop-invite">
            <span className="chip">
              <Sprite id="teammate_arrow" scale={1} />
              {t("coop.linkLabel")}
            </span>
            <span className="chip chip-caps chip-live">
              <Sprite id="chip_done" scale={1} />
              {t("coop.linkCopied")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
