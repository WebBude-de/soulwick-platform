import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // Content read at runtime, not imported: optional legal fallback files
  // (src/lib/legal-files.ts) and the news posts (src/lib/news.ts) for the landing page, the
  // sitemap and the background refresh of the prebuilt news pages. Keys match every route whose
  // path contains them (`/` = all routes, the pages live under the hidden `[locale]` segment).
  outputFileTracingIncludes: {
    "/imprint": ["./content/legal/*.html"],
    "/privacy": ["./content/legal/*.html"],
    "/": ["./content/news/*/*.md"],
    "/sitemap.xml": ["./content/news/*/*.md"],
  },
  experimental: {
    // `app/global-not-found.tsx`: 404 for URLs outside the `[locale]` segment (no root layout there).
    globalNotFound: true,
  },
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@soulwick/contracts"],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
