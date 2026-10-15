import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // Optional legal fallback files are read at runtime (src/lib/legal-files.ts), not imported.
  outputFileTracingIncludes: {
    "/imprint": ["./content/legal/*.html"],
    "/privacy": ["./content/legal/*.html"],
  },
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@soulwick/contracts"],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
