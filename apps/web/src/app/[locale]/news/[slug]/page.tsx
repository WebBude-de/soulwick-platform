import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Markdown } from "@/components/news/markdown";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { Sprite } from "@/components/ui/sprite";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locale";
import { brand, brandAsset } from "@/lib/brand";
import { playLinks } from "@/lib/game";
import { formatNewsDate, getNews, listNews } from "@/lib/news";
import "@/components/news/news.css";

/**
 * Built ahead of time, one page per post and language (the language is the hidden `[locale]`
 * segment, see `src/proxy.ts`): posts only change with a deploy, so no request reads a file.
 * Unknown slugs are a 404 without rendering.
 */
export const dynamicParams = false;

/**
 * Header and article end show the live switch (`LIVE_FEATURES`, `GAME_URL`), which Dokploy flips
 * with a restart: the built pages are rebuilt in the background at most every five minutes and
 * so pick it up without a new deploy. Posts themselves only change with a deploy.
 */
export const revalidate = 300;

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateStaticParams({
  params,
}: {
  params: { locale: string };
}): Promise<{ slug: string }[]> {
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return (await listNews(locale)).map((post) => ({ slug: post.slug }));
}

const BRAND_PREFIX = "/brand/";

/** A cover image only counts when the file exists in `public/brand/`. */
function coverSrc(image: string | null): string | null {
  if (!image?.startsWith(BRAND_PREFIX)) {
    return null;
  }
  return brandAsset(image.slice(BRAND_PREFIX.length));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const locale = (await getLocale()) as Locale;
  const post = await getNews(slug, locale);
  if (!post) {
    return {};
  }
  const cover = coverSrc(post.image);
  const og = cover
    ? { src: cover, width: 1200, height: 630 }
    : brand.ogImage(locale);
  return {
    title: post.title,
    description: post.summary || undefined,
    alternates: { canonical: `/news/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.summary || undefined,
      publishedTime: post.date,
      images: og
        ? [{ url: og.src, width: og.width, height: og.height }]
        : undefined,
    },
  };
}

export default async function NewsPostRoute({ params }: Props) {
  const { slug } = await params;
  const locale = (await getLocale()) as Locale;
  const post = await getNews(slug, locale);
  if (!post) {
    notFound();
  }
  const t = await getTranslations("news");
  const others = (await listNews(locale))
    .filter((other) => other.slug !== post.slug)
    .slice(0, 3);
  const cover = coverSrc(post.image);
  const game = playLinks();

  return (
    <div className="news-page container-site">
      <article className="news-article">
        <Link className="news-back" href="/news">
          {t("back")}
        </Link>
        <header className="news-article-head">
          <time className="news-date" dateTime={post.date}>
            {formatNewsDate(post.date, locale)}
          </time>
          <h1 className="news-article-title">{post.title}</h1>
          {post.summary ? <p className="lead">{post.summary}</p> : null}
          {post.fallback ? (
            <p className="news-fallback" lang={post.locale}>
              {t("fallback", { language: t(`languages.${post.locale}`) })}
            </p>
          ) : null}
        </header>
        {cover ? (
          // biome-ignore lint/performance/noImgElement: delivered pixel illustration, shown 1:1 without optimisation.
          <img
            alt=""
            className="news-cover"
            height={630}
            src={cover}
            width={1200}
          />
        ) : null}
        <div lang={post.locale}>
          <Markdown source={post.body} />
        </div>
        <footer className="news-article-end">
          {game ? (
            <a className="btn btn-primary" href={game.play}>
              <PixelIcon name="play" />
              {t("play")}
            </a>
          ) : (
            <span className="chip chip-lit news-release">
              <Sprite id="torch_4f" scale={1} still />
              {t("release")}
            </span>
          )}
          <Link className="btn" href="/#koop">
            {t("discover")}
          </Link>
        </footer>
      </article>

      {others.length > 0 ? (
        <aside aria-labelledby="news-more" className="news-more">
          <h2 className="news-more-title" id="news-more">
            {t("more")}
          </h2>
          <ul className="news-more-list">
            {others.map((other) => (
              <li key={other.slug}>
                <time className="news-date" dateTime={other.date}>
                  {formatNewsDate(other.date, locale)}
                </time>
                <Link href={`/news/${other.slug}`}>{other.title}</Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
