import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PixelButton } from "@/components/ui/pixel-button";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import {
  GAME_REPO_URL,
  ISSUES_URL,
  PLATFORM_REPO_URL,
  RELEASES_URL,
} from "@/lib/open-source";

/** Open source page (header tab "Open Source"): both GitHub repositories, releases, bug reports. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opensource");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: { canonical: "/open-source" },
  };
}

const REPOS = [
  { key: "game", href: GAME_REPO_URL, sprite: "icon_sword" },
  { key: "platform", href: PLATFORM_REPO_URL, sprite: "icon_host" },
] as const;

const JOIN = [
  { key: "download", href: RELEASES_URL, sprite: "chest_closed" },
  { key: "bugs", href: ISSUES_URL, sprite: "skull_icon" },
  { key: "build", href: GAME_REPO_URL, sprite: "icon_hammer" },
] as const;

const linkClass = "text-violet-link underline hover:text-gold";

export default async function OpenSourceRoute() {
  const t = await getTranslations("opensource");
  const tc = await getTranslations("common");

  return (
    <div className="container-site py-10 sm:py-14">
      <article className="flex max-w-4xl flex-col gap-12">
        <header className="flex items-end gap-5">
          <Sprite className="hidden shrink-0 sm:block" id="soul_flame_6f" />
          <div className="flex flex-col gap-3">
            <p className="eyebrow">GitHub</p>
            <h1 className="text-3xl text-gold sm:text-4xl">{t("title")}</h1>
            <p className="lead">{t("lead")}</p>
          </div>
        </header>

        <section aria-labelledby="repos" className="flex flex-col gap-5">
          <h2 className="text-gold text-xl sm:text-2xl" id="repos">
            {t("repos.title")}
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {REPOS.map((repo) => (
              <PixelPanel
                as="section"
                className="flex flex-col gap-4 p-6"
                key={repo.key}
              >
                <h3 className="flex items-center gap-2 text-lg text-text">
                  <Sprite id={repo.sprite} scale={1} />
                  <span>{t(`repos.${repo.key}.title`)}</span>
                </h3>
                <p className="text-soft">{t(`repos.${repo.key}.text`)}</p>
                <p className="break-all font-mono text-[13px] text-muted">
                  {repo.href.replace("https://", "")}
                </p>
                <PixelButton
                  className="mt-auto self-start"
                  external
                  href={repo.href}
                  size="sm"
                  variant={repo.key === "game" ? "primary" : "default"}
                >
                  {t(`repos.${repo.key}.link`)}
                  <span className="sr-only"> {tc("footer.newTab")}</span>
                </PixelButton>
              </PixelPanel>
            ))}
          </div>
        </section>

        <section aria-labelledby="join" className="flex flex-col gap-5">
          <h2 className="text-gold text-xl sm:text-2xl" id="join">
            {t("join.title")}
          </h2>
          <ul className="grid gap-6 md:grid-cols-3">
            {JOIN.map((item) => (
              <li
                className="flex flex-col gap-1.5 border-line border-l-2 pl-4"
                key={item.key}
              >
                <h3 className="flex items-center gap-2 text-lg text-text">
                  <Sprite id={item.sprite} scale={1} />
                  <span>{t(`join.${item.key}.title`)}</span>
                </h3>
                <p className="text-soft">{t(`join.${item.key}.text`)}</p>
                <a
                  className={linkClass}
                  href={item.href}
                  rel="noopener"
                  target="_blank"
                >
                  {t(`join.${item.key}.link`)}
                  <span className="sr-only"> {tc("footer.newTab")}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </div>
  );
}
