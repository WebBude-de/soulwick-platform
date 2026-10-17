import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { NewsScene } from "@/components/news/news-scene";
import type { Locale } from "@/i18n/locale";
import { brand } from "@/lib/brand";
import { formatNewsDate, listNews } from "@/lib/news";
import "@/components/news/news.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("news");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: { canonical: "/news" },
  };
}

/**
 * Built ahead of time per language like the posts (`[slug]/page.tsx`), refreshed within five
 * minutes so the header follows the live switch after a restart.
 */
export const revalidate = 300;

/** Devlog overview: all posts from `content/news`, newest first, in the page language. */
export default async function NewsRoute() {
  const t = await getTranslations("news");
  const locale = (await getLocale()) as Locale;
  const posts = await listNews(locale);

  return (
    <div className="news-page">
      <header className="news-head">
        <div className="container-site news-head-inner">
          <div className="news-head-copy flex flex-col gap-4">
            <h1 className="news-title">{t("title")}</h1>
            <p className="lead max-w-xl">{t("lead")}</p>
          </div>
          <NewsScene art={brand.wick()} />
        </div>
      </header>

      <div className="container-site news-body">
        {posts.length === 0 ? (
          <p className="news-empty">{t("empty")}</p>
        ) : (
          <ol className="news-timeline">
            {posts.map((post) => (
              <li key={post.slug}>
                <article className="news-entry">
                  <time className="news-date" dateTime={post.date}>
                    {formatNewsDate(post.date, locale)}
                  </time>
                  <h2 className="news-entry-title">
                    <Link href={`/news/${post.slug}`}>{post.title}</Link>
                  </h2>
                  {post.summary ? (
                    <p className="news-entry-summary">{post.summary}</p>
                  ) : null}
                  <span aria-hidden="true" className="news-entry-more">
                    {t("read")}
                  </span>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
