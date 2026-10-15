import Link from "next/link";
import { useTranslations } from "next-intl";
import { Chicken } from "@/components/fun/chicken";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Sprite } from "@/components/ui/sprite";

const linkClass =
  "inline-flex min-h-9 items-center text-[15px] text-text transition-colors hover:text-gold";

/** Footer (handoff §3, row 8): mono logo, short text, game links, legal links, language. */
export function SiteFooter() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const links = t.raw("navLinks") as [string, string][];
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-0 border-line border-t-2 bg-bg-footer">
      <span className="footer-chicken">
        <Chicken />
      </span>
      <div className="container-site grid gap-10 py-14 md:grid-cols-[1.3fr_1fr_1fr]">
        <div className="flex max-w-xs flex-col gap-4">
          {/* biome-ignore lint/performance/noImgElement: crisp-edges SVG wordmark, no optimisation needed. */}
          <img
            alt={tc("siteName")}
            height={30}
            src="/brand/logo_mono.svg"
            width={100}
          />
          <p className="text-[15px] text-soft leading-relaxed">
            {t("footerText")}
          </p>
        </div>

        <nav aria-label={t("footerGame")}>
          <p className="eyebrow mb-3 text-disabled">{t("footerGame")}</p>
          <ul className="flex flex-col">
            {links.map(([label, hash]) => (
              <li key={hash}>
                <a className={linkClass} href={`/${hash}`}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t("footerLegal")}>
          <p className="eyebrow mb-3 text-disabled">{t("footerLegal")}</p>
          <ul className="flex flex-col">
            <li>
              <Link className={linkClass} href="/imprint">
                {t("imprint")}
              </Link>
            </li>
            <li>
              <Link className={linkClass} href="/privacy">
                {t("privacy")}
              </Link>
            </li>
            <li>
              <Link className={linkClass} href="/delete-account">
                {t("deleteAccount")}
              </Link>
            </li>
          </ul>
          <p className="mt-3 max-w-xs text-[13px] text-disabled leading-relaxed">
            {t("legalNote")}
          </p>
        </nav>
      </div>

      <div className="container-site flex flex-col gap-3 border-line border-t pt-6 pb-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          {tc("footer.copyright", { year })} ·{" "}
          {t.rich("footerCredit", {
            heart: () => (
              <span className="inline-block align-[-3px]">
                <Sprite alt="♥" id="heart_full" scale={1} />
              </span>
            ),
          })}
        </p>
        <div className="flex items-center gap-4">
          <LanguageSwitch variant="text" />
        </div>
      </div>
    </footer>
  );
}
