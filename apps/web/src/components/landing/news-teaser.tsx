import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SocialLinks } from "@/components/site/social-links";
import { SectionIntro } from "@/components/ui/section-intro";
import type { Locale } from "@/i18n/locale";
import { formatNewsDate, listNews } from "@/lib/news";
import { socialLinks } from "@/lib/social";

/**
 * Latest posts from the devlog, so the landing page shows that Soulwick is alive, and the social
 * channels to follow along (only those with a URL in `content/social.json`).
 */
export async function NewsTeaser({ locale }: { locale: Locale }) {
  const t = await getTranslations("landing");
  const posts = (await listNews(locale)).slice(0, 2);
  const social = socialLinks();
  if (posts.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="news-teaser-title" className="news-teaser">
      <div className="container-site flex flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionIntro
            id="news-teaser-title"
            text={t("newsTeaser.lead")}
            title={t("newsTeaser.title")}
          />
          <Link className="text-link" href="/news">
            {t("newsTeaser.all")}
          </Link>
        </div>
        <ul className="news-teaser-list">
          {posts.map((post) => (
            <li key={post.slug}>
              <article className="news-card">
                <time className="news-date" dateTime={post.date}>
                  {formatNewsDate(post.date, locale)}
                </time>
                <h3 className="news-card-title">
                  <Link href={`/news/${post.slug}`}>{post.title}</Link>
                </h3>
                {post.summary ? (
                  <p className="news-card-summary">{post.summary}</p>
                ) : null}
                <span aria-hidden="true" className="news-card-more">
                  {t("newsTeaser.read")}
                </span>
              </article>
            </li>
          ))}
        </ul>
        {social.length > 0 ? (
          <div className="news-follow">
            <h3 className="news-follow-title">{t("newsTeaser.followTitle")}</h3>
            <SocialLinks links={social} variant="row" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
