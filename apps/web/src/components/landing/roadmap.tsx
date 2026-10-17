import { useTranslations } from "next-intl";
import { SectionIntro } from "@/components/ui/section-intro";
import { Sprite } from "@/components/ui/sprite";

/**
 * "What's next": only what comes after the release (D-179). Everything the page shows above is in
 * the game at release, on every platform (browser, Steam, Android, iOS together, project member
 * 17.10.2026); here follow the party mode and more content, as a path of torches where the lit
 * one is up next. No dates, no prices.
 */
export function Roadmap() {
  const t = useTranslations("landing");
  const steps = t.raw("roadmap.steps") as [string, string][];

  return (
    <section aria-labelledby="roadmap-title" className="roadmap" id="was-kommt">
      <div className="container-site flex flex-col gap-12">
        <SectionIntro
          id="roadmap-title"
          text={t("roadmap.lead")}
          title={t("roadmap.title")}
        />

        <ol className="roadmap-path">
          {steps.map(([title, text], i) => {
            const lit = i === 0;
            return (
              <li
                className="roadmap-step"
                data-lit={lit ? "" : undefined}
                key={title}
              >
                <span aria-hidden="true" className="roadmap-torch">
                  <Sprite id={lit ? "torch_stand_4f" : "torch_stand_unlit"} />
                </span>
                <div className="roadmap-card">
                  <strong className="roadmap-step-title">{title}</strong>
                  <p className="roadmap-step-text">{text}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="roadmap-legend">{t("roadmap.legend")}</p>
      </div>
    </section>
  );
}
