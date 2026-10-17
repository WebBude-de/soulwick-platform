import Link from "next/link";
import { useTranslations } from "next-intl";
import { Chicken } from "@/components/fun/chicken";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Sprite } from "@/components/ui/sprite";
import { socialLinks } from "@/lib/social";
import type { NavLink } from "./nav-links";
import { SocialLinks } from "./social-links";

/** Studio credit link; the UTM tags tell WebBude the visit came from this site. */
const STUDIO_URL =
  "https://web-bude.de/?utm_source=playsoulwick.com&utm_medium=referral&utm_campaign=made_with_love";

const linkClass =
  "inline-flex min-h-9 items-center text-[15px] text-text transition-colors hover:text-gold";

/**
 * Footer (handoff §3, row 8): mono logo, short text, game links, legal links, the community
 * channels that exist (`content/social.json`, column only with at least one URL), language.
 */
export function SiteFooter() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const links = [
    ...(t.raw("navLinks") as NavLink[]),
    ...(t.raw("navExtra") as NavLink[]),
  ];
  const social = socialLinks();
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-0 border-line border-t-2 bg-bg-footer">
      <span className="footer-chicken">
        <Chicken />
      </span>
      <div
        className={`container-site grid gap-10 py-14 ${social.length > 0 ? "sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]" : "md:grid-cols-[1.3fr_1fr_1fr]"}`}
      >
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
        </nav>

        {social.length > 0 ? (
          <nav aria-label={t("footerCommunity")}>
            <p className="eyebrow mb-3 text-disabled">{t("footerCommunity")}</p>
            <SocialLinks links={social} variant="list" />
          </nav>
        ) : null}
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
            studio: (chunks) => (
              // noopener without noreferrer: the referrer should reach WebBude.
              <a
                className="credit-link"
                href={STUDIO_URL}
                rel="noopener"
                target="_blank"
              >
                {chunks}
                <span className="sr-only"> {tc("footer.newTab")}</span>
              </a>
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
