import {
  DELETION_CODE_TTL_SECONDS,
  DELETION_TOKEN_TTL_SECONDS,
} from "@soulwick/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DeletionFlow } from "@/components/deletion/deletion-form";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import { loadSupportEmail, mailtoHref } from "@/lib/support";

/**
 * Per request: the support address comes from the API (`GET /public/config`), which the build
 * does not reach, and the form posts to a Server Action.
 */
export const dynamic = "force-dynamic";

/** Public URL for account deletion (Google Play requirement, KONZEPT_ONLINE.md §3.7, P-026). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("deletion");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: { canonical: "/delete-account" },
    robots: { index: true, follow: true },
  };
}

const GONE = ["account", "logins", "guild"] as const;
const WEB_STEPS = ["code", "enter", "confirm"] as const;

const linkClass = "text-violet-link underline hover:text-gold";

export default async function DeleteAccountRoute() {
  const t = await getTranslations("deletion");
  const supportEmail = await loadSupportEmail();
  const codeMinutes = Math.round(DELETION_CODE_TTL_SECONDS / 60);

  return (
    <div className="container-site py-10 sm:py-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-14">
        <article className="flex max-w-2xl flex-col gap-10">
          <header className="flex items-end gap-5">
            <Sprite className="hidden shrink-0 sm:block" id="soul_flame_6f" />
            <div className="flex flex-col gap-3">
              <h1 className="text-3xl text-gold sm:text-4xl">{t("title")}</h1>
              <p className="lead">{t("lead")}</p>
              <a className="btn btn-sm self-start lg:hidden" href="#loeschen">
                {t("toForm")}
              </a>
            </div>
          </header>

          <section
            aria-labelledby="deletion-ways"
            className="flex flex-col gap-5"
          >
            <h2 className="text-gold text-xl sm:text-2xl" id="deletion-ways">
              {t("ways.title")}
            </h2>
            <div className="flex flex-col gap-1.5 border-line border-l-2 pl-4">
              <h3 className="flex items-center gap-2 text-lg text-text">
                <Sprite id="icon_sword" scale={1} />
                <span>{t("ways.inGame.title")}</span>
              </h3>
              <p className="text-soft">{t("ways.inGame.text")}</p>
            </div>
            <div className="flex flex-col gap-3 border-gold-dark border-l-2 pl-4">
              <h3 className="flex items-center gap-2 text-lg text-text">
                <Sprite id="icon_lock" scale={1} />
                <span>{t("ways.web.title")}</span>
              </h3>
              <ol className="flex flex-col gap-3">
                {WEB_STEPS.map((key, index) => (
                  <li className="flex items-start gap-3 text-soft" key={key}>
                    <span className="w-5 shrink-0 font-pixel text-gold text-lg leading-6">
                      {index + 1}
                    </span>
                    <span>
                      {t(`ways.web.steps.${key}`, { minutes: codeMinutes })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section
            aria-labelledby="deletion-what"
            className="flex flex-col gap-4"
          >
            <h2 className="text-gold text-xl sm:text-2xl" id="deletion-what">
              {t("deleted.title")}
            </h2>
            <ul className="flex flex-col gap-3">
              {GONE.map((key) => (
                <li className="flex items-start gap-3 text-soft" key={key}>
                  <Sprite className="mt-1 shrink-0" id="skull_icon" scale={2} />
                  <span>{t(`deleted.gone.${key}`)}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-2 text-lg text-text">{t("deleted.keptTitle")}</h3>
            <p className="flex items-start gap-3 text-soft">
              <Sprite className="mt-1 shrink-0" id="trophy_icon" scale={2} />
              <span>{t("deleted.kept.runs")}</span>
            </p>
            <p className="flex items-start gap-3 text-soft">
              <Sprite className="mt-1 shrink-0" id="shield_icon" scale={2} />
              <span>{t("deleted.kept.device")}</span>
            </p>
          </section>

          <section
            aria-labelledby="deletion-no-access"
            className="flex scroll-mt-24 flex-col gap-3"
            id="no-access"
          >
            <h2
              className="text-gold text-xl sm:text-2xl"
              id="deletion-no-access"
            >
              {t("noAccess.title")}
            </h2>
            {supportEmail ? (
              <>
                <p className="text-soft">
                  {t.rich("noAccess.mail", {
                    mail: () => (
                      <a
                        className={`${linkClass} break-all`}
                        href={mailtoHref(supportEmail, {
                          subject: t("noAccess.subject"),
                          body: t("noAccess.body"),
                        })}
                      >
                        {supportEmail}
                      </a>
                    ),
                  })}
                </p>
                <p className="text-soft">
                  {t.rich("noAccess.deadline", {
                    link: (chunks) => (
                      <Link className={linkClass} href="/privacy">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              </>
            ) : (
              <p className="text-soft">
                {t.rich("noAccess.fallback", {
                  link: (chunks) => (
                    <Link className={linkClass} href="/imprint">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </section>

          <p className="text-muted text-sm">
            {t.rich("rights", {
              link: (chunks) => (
                <Link className={linkClass} href="/privacy">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </article>

        <section
          aria-label={t("panelLabel")}
          className="scroll-mt-24 lg:sticky lg:top-24"
          id="loeschen"
        >
          <PixelPanel className="p-5 sm:p-7" variant="gold">
            <DeletionFlow
              codeMinutes={codeMinutes}
              confirmMinutes={Math.round(DELETION_TOKEN_TTL_SECONDS / 60)}
            />
          </PixelPanel>
        </section>
      </div>
    </div>
  );
}
