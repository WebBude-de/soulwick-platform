import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy.ts";

/**
 * Language without URL prefix (P-012): the proxy rewrites every page to the hidden `[locale]`
 * segment, which lets the news be built ahead of time per language.
 */

const webRoot = path.resolve(import.meta.dir, "..");

function request(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(pathname, "https://playsoulwick.com"), {
    headers,
  });
}

/** Internal path the proxy rewrote to (`x-middleware-rewrite`), without the origin. */
function rewrittenPath(response: Response): string | null {
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("proxy", () => {
  it("rewrites to the cookie language, keeping the address", () => {
    const response = proxy(request("/news", { cookie: "NEXT_LOCALE=de" }));
    expect(rewrittenPath(response)).toBe("/de/news");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("falls back to Accept-Language, then English", () => {
    expect(
      rewrittenPath(
        proxy(
          request("/news/where-we-are-headed", {
            "accept-language": "de-DE,de;q=0.9",
          })
        )
      )
    ).toBe("/de/news/where-we-are-headed");
    expect(rewrittenPath(proxy(request("/")))).toBe("/en");
    expect(
      rewrittenPath(
        proxy(
          request("/leaderboards", {
            cookie: "NEXT_LOCALE=fr",
            "accept-language": "fr",
          })
        )
      )
    ).toBe("/en/leaderboards");
  });

  it("redirects old prefixed links and remembers their language", () => {
    const response = proxy(request("/de/ranglisten"));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe(
      "/leaderboards"
    );
    expect(response.headers.get("set-cookie")).toContain("NEXT_LOCALE=de");
  });
});

describe("static news", () => {
  const page = (file: string) =>
    readFileSync(path.join(webRoot, "src/app/[locale]/news", file), "utf8");

  it("builds overview and posts ahead of time and refreshes them in the background", () => {
    for (const file of ["page.tsx", "[slug]/page.tsx"]) {
      const source = page(file);
      expect(source).not.toContain("force-dynamic");
      expect(source).toContain("export const revalidate = 300;");
    }
    const post = page("[slug]/page.tsx");
    expect(post).toContain("export async function generateStaticParams");
    expect(post).toContain("export const dynamicParams = false;");
  });
});
