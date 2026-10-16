import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The teaser switch (`LIVE_FEATURES`) on the routes that do not need a running Next.js request:
 * sitemap, navigation, the guild and leaderboards pages, and the legal file fallback.
 */

// `server-only` throws outside the react-server condition; Next.js resolves it to an empty module.
mock.module("server-only", () => ({}));
const { default: sitemap } = await import("../src/app/sitemap.ts");
const { visibleNavLinks } = await import("../src/components/site/nav-links.ts");
const guildPage = await import("../src/app/guilds/[tag]/page.tsx");
const leaderboardsPage = await import("../src/app/leaderboards/page.tsx");
const { withLegalFileFallback } = await import("../src/lib/legal-files.ts");

const ORIGINAL_LIVE = process.env.LIVE_FEATURES;
const ORIGINAL_FETCH = globalThis.fetch;
let fetchedUrls: string[] = [];

beforeEach(() => {
  fetchedUrls = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    fetchedUrls.push(String(input instanceof Request ? input.url : input));
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_LIVE === undefined) {
    delete process.env.LIVE_FEATURES;
  } else {
    process.env.LIVE_FEATURES = ORIGINAL_LIVE;
  }
});

/** `notFound()` throws an error whose digest marks the 404 fallback. */
async function expectNotFound(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(Error);
  expect(String((error as { digest?: string }).digest)).toContain("404");
}

describe("sitemap", () => {
  it("lists the leaderboards while live", () => {
    process.env.LIVE_FEATURES = "true";
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).toContain("/leaderboards");
    expect(urls).toContain("/delete-account");
  });

  it("drops the leaderboards in teaser mode but keeps the other pages", () => {
    process.env.LIVE_FEATURES = "false";
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).not.toContain("/leaderboards");
    expect(urls).toEqual([
      "/",
      "/open-source",
      "/privacy",
      "/imprint",
      "/delete-account",
    ]);
  });
});

describe("navigation links", () => {
  const links: [string, string][] = [
    ["Game", "#spiel"],
    ["Co-op & Guilds", "#koop"],
    ["Leaderboards", "#ranglisten"],
    ["Open source", "open-source"],
  ];

  it("keeps every link while live", () => {
    expect(visibleNavLinks(links, true)).toEqual(links);
  });

  it("drops only the leaderboards anchor in teaser mode", () => {
    expect(visibleNavLinks(links, false)).toEqual([
      ["Game", "#spiel"],
      ["Co-op & Guilds", "#koop"],
      ["Open source", "open-source"],
    ]);
  });
});

describe("guild page", () => {
  const props = { params: Promise.resolve({ tag: "DOCHT" }) };

  it("is a 404 without any API call in teaser mode", async () => {
    process.env.LIVE_FEATURES = "false";
    await expectNotFound(guildPage.default(props));
    await expectNotFound(guildPage.generateMetadata(props));
    expect(fetchedUrls).toEqual([]);
  });

  it("asks the API for the guild while live", async () => {
    process.env.LIVE_FEATURES = "true";
    // The mocked API answers 404, which the page turns into notFound() after the call.
    await expectNotFound(guildPage.default(props));
    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toEndWith("/public/guilds/DOCHT");
  });
});

describe("leaderboards page", () => {
  it("is a 404 without any API call in teaser mode", async () => {
    process.env.LIVE_FEATURES = "false";
    await expectNotFound(
      leaderboardsPage.default({ searchParams: Promise.resolve({}) })
    );
    await expectNotFound(leaderboardsPage.generateMetadata());
    expect(fetchedUrls).toEqual([]);
  });

  it("is rendered per request", () => {
    expect(leaderboardsPage.dynamic).toBe("force-dynamic");
    expect(guildPage.dynamic).toBe("force-dynamic");
  });
});

describe("legal file fallback", () => {
  const dirs: string[] = [];
  const missing = { state: "missing", reason: "missing" } as const;

  async function legalDir(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "soulwick-legal-"));
    dirs.push(dir);
    await Promise.all(
      Object.entries(files).map(([name, html]) =>
        writeFile(path.join(dir, name), html, "utf8")
      )
    );
    return dir;
  }

  afterAll(async () => {
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it("keeps the placeholder without a file", async () => {
    const dir = await legalDir({});
    expect(await withLegalFileFallback(missing, "imprint", "de", dir)).toEqual(
      missing
    );
  });

  it("shows the file of the page locale first", async () => {
    const dir = await legalDir({
      "imprint.de.html": "<p>DE</p>",
      "imprint.en.html": "<p>EN</p>",
    });
    const view = await withLegalFileFallback(missing, "imprint", "en", dir);
    expect(view).toMatchObject({
      state: "ready",
      html: "<p>EN</p>",
      htmlLocale: "en",
      fallback: false,
    });
  });

  it("falls back to the other locale, marked as fallback", async () => {
    const dir = await legalDir({ "privacy.de.html": "<p>DE</p>" });
    const view = await withLegalFileFallback(
      { state: "missing", reason: "unreachable" },
      "privacy",
      "en",
      dir
    );
    expect(view).toMatchObject({
      state: "ready",
      htmlLocale: "de",
      fallback: true,
    });
  });

  it("ignores empty files and never replaces a text from the API", async () => {
    const dir = await legalDir({ "imprint.en.html": "  \n" });
    expect(await withLegalFileFallback(missing, "imprint", "en", dir)).toEqual(
      missing
    );
    const ready = {
      state: "ready",
      html: "<p>API</p>",
      htmlLocale: "en",
      fallback: false,
      modifiedAt: null,
      warnings: [],
    } as const;
    const withFile = await legalDir({ "imprint.en.html": "<p>FILE</p>" });
    expect(await withLegalFileFallback(ready, "imprint", "en", withFile)).toBe(
      ready
    );
  });
});
