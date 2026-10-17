import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sprite } from "@/components/ui/sprite";

/** One quiet line before the footer: the code is open, the art and the characters are not (D-177). */
export function OpenSourceStrip() {
  const t = useTranslations("landing");

  return (
    <aside aria-labelledby="open-source-title" className="oss-strip">
      <div className="container-site oss-strip-inner">
        <Sprite id="icon_hammer" scale={2} />
        <p>
          <strong id="open-source-title">{t("openSource.title")}.</strong>{" "}
          {t("openSource.text")}{" "}
          <Link className="text-link" href="/open-source">
            {t("openSource.link")}
          </Link>
        </p>
      </div>
    </aside>
  );
}
