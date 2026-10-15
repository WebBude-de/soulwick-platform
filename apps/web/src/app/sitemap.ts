import type { MetadataRoute } from "next";
import { liveFeaturesEnabled } from "@/lib/features";
import { SITE_URL } from "@/lib/metadata";

/** Per request, so `LIVE_FEATURES` decides at runtime whether the leaderboards are listed. */
export const dynamic = "force-dynamic";

/**
 * Plain paths, one entry each (the language is not part of the URL). Guild pages are reached
 * through the leaderboards and are not listed.
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
  { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
  { path: "/imprint", changeFrequency: "monthly", priority: 0.3 },
  { path: "/delete-account", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const live = liveFeaturesEnabled();
  return ROUTES.filter((route) => live || !route.live).map((route) => ({
    url: new URL(route.path, SITE_URL).toString(),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
