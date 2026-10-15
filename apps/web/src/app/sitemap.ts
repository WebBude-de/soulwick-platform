import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/metadata";

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
}[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/leaderboards", changeFrequency: "hourly", priority: 0.8 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
  { path: "/imprint", changeFrequency: "monthly", priority: 0.3 },
  { path: "/delete-account", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((route) => ({
    url: new URL(route.path, SITE_URL).toString(),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
