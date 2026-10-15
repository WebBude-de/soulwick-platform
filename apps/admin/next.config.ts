import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@soulwick/contracts"],
  poweredByHeader: false,
  // Deletion requests were replaced by the deletion log (P-026); old bookmarks land there.
  redirects: async () => [
    { source: "/loeschantraege", destination: "/loeschungen", permanent: true },
  ],
};

export default nextConfig;
