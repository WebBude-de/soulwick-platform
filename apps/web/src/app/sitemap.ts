import type { MetadataRoute } from "next";
import { liveFeaturesEnabled } from "@/lib/features";
import { SITE_URL } from "@/lib/metadata";
import { listNews } from "@/lib/news";

/** Per request, so `LIVE_FEATURES` decides at runtime whether the leaderboards are listed. */
export const dynamic = "force-dynamic";

/**
 * Plain paths, one entry each (the language is not part of the URL). Guild pages are reached
 * through the leaderboards and are not listed; news posts are added from `content/news`.
 */
const ROUTES: {
  path: string;
  changeFrequency: NonNullable<
    MetadataRoute.Sitemap[number]["changeFrequency"]
  >;
  priority: number;
  /** Only listed while the online parts are live (`LIVE_FEATURES`). */
  live?: boolean;
}[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  {
    path: "/leaderboards",
    changeFrequency: "hourly",
    priority: 0.8,
    live: true,
  },
  { path: "/news", changeFrequency: "weekly", priority: 0.7 },
  { path: "/open-source", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
  { path: "/imprint", changeFrequency: "monthly", priority: 0.3 },
  { path: "/delete-account", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const live = liveFeaturesEnabled();
  const pages: MetadataRoute.Sitemap = ROUTES.filter(
    (route) => live || !route.live
  ).map((route) => ({
    url: new URL(route.path, SITE_URL).toString(),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
  // Posts exist in English (the default language) or as a fallback in German.
  const posts = (await listNews("en")).map((post) => ({
    url: new URL(`/news/${post.slug}`, SITE_URL).toString(),
    lastModified: new Date(`${post.date}T00:00:00Z`),
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));
  return [...pages, ...posts];
}
