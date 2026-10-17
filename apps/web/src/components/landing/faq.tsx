import { useTranslations } from "next-intl";
import { SectionIntro } from "@/components/ui/section-intro";

interface FaqProps {
  /** `LIVE_FEATURES`: Soulwick is out, so "when?" becomes "where do I get it?". */
  live: boolean;
}

/**
 * Short, honest answers (no prices, no dates), as native disclosure widgets: no JS needed. The
 * release question follows the live switch, so it never goes stale after the release.
 */
export function Faq({ live }: FaqProps) {
  const t = useTranslations("landing");
  const items = [
    ...(t.raw("faq.items") as [string, string][]),
    t.raw(live ? "faq.released" : "faq.release") as [string, string],
  ];

  return (
    <section aria-labelledby="faq-title" className="faq" id="faq">
      <div className="container-site faq-grid">
        <SectionIntro id="faq-title" title={t("faq.title")} />
        <div className="faq-list">
          {items.map(([question, answer]) => (
            <details className="faq-item" key={question}>
              <summary>
                <span>{question}</span>
                <span aria-hidden="true" className="faq-mark" />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
