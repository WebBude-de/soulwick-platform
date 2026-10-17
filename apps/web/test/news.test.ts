import { afterAll, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** News posts (`content/news`) and the Markdown subset they are written in. */

// `server-only` throws outside the react-server condition; Next.js resolves it to an empty module.
mock.module("server-only", () => ({}));
const { getNews, isNewsSlug, listNews, parseNewsFile } = await import(
  "../src/lib/news.ts"
);
const { parseInline, parseMarkdown } = await import("../src/lib/markdown.ts");

const CONTENT_DIR = fileURLToPath(new URL("../content/news", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function newsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "soulwick-news-"));
  dirs.push(dir);
  await Promise.all(
    Object.entries(files).map(async ([name, text]) => {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), text, "utf8");
    })
  );
  return dir;
}

const post = (title: string, date: string, extra = "") =>
  `---\ntitle: ${title}\ndate: ${date}\nsummary: About ${title}${extra}\n---\n\nBody of ${title}.\n`;

describe("parseNewsFile", () => {
  it("reads title, date, summary and body", () => {
    const parsed = parseNewsFile(
      '---\ntitle: "Hello: world"\ndate: 2026-10-17\nsummary: Short: really\n---\n\n## Hi\n'
    );
    expect(parsed).toMatchObject({
      title: "Hello: world",
      date: "2026-10-17",
      summary: "Short: really",
      draft: false,
      image: null,
      body: "## Hi",
    });
  });

  it("rejects files without front matter, title or a valid date", () => {
    expect(parseNewsFile("# Just text")).toBeNull();
    expect(parseNewsFile("---\ndate: 2026-10-17\n---\nx")).toBeNull();
    expect(parseNewsFile("---\ntitle: X\ndate: 17.10.2026\n---\nx")).toBeNull();
  });

  it("only keeps site-relative images", () => {
    expect(
      parseNewsFile(
        "---\ntitle: X\ndate: 2026-10-17\nimage: https://x.test/a.webp\n---\n"
      )?.image
    ).toBeNull();
    expect(
      parseNewsFile(
        "---\ntitle: X\ndate: 2026-10-17\nimage: /brand/news/a.webp\n---\n"
      )?.image
    ).toBe("/brand/news/a.webp");
  });
});

describe("listNews and getNews", () => {
  it("lists published posts newest first in the page language", async () => {
    const dir = await newsDir({
      "older-post/en.md": post("Older", "2026-09-01"),
      "older-post/de.md": post("Älter", "2026-09-01"),
      "newer-post/en.md": post("Newer", "2026-10-01"),
      "secret-post/en.md": post("Secret", "2026-10-05", "\ndraft: true"),
      "Bad Slug/en.md": post("Bad", "2026-10-06"),
      "README.md": "not a post",
    });
    const de = await listNews("de", dir);
    expect(de.map((p) => [p.slug, p.title, p.fallback])).toEqual([
      ["newer-post", "Newer", true],
      ["older-post", "Älter", false],
    ]);
  });

  it("falls back to the other language and rejects unknown slugs", async () => {
    const dir = await newsDir({
      "only-german/de.md": post("Nur Deutsch", "2026-10-01"),
    });
    expect(await getNews("only-german", "en", dir)).toMatchObject({
      title: "Nur Deutsch",
      locale: "de",
      fallback: true,
    });
    expect(await getNews("missing", "en", dir)).toBeNull();
    expect(await getNews("../etc", "en", dir)).toBeNull();
    expect(isNewsSlug("where-we-are-headed")).toBe(true);
    expect(isNewsSlug("Where_We")).toBe(false);
  });

  it("never throws for a missing folder", async () => {
    expect(
      await listNews("en", path.join(tmpdir(), "soulwick-no-news"))
    ).toEqual([]);
  });

  it("has every repo post in English and German", async () => {
    const [en, de] = await Promise.all([
      listNews("en", CONTENT_DIR),
      listNews("de", CONTENT_DIR),
    ]);
    expect(en.length).toBeGreaterThan(0);
    expect(en.every((p) => !p.fallback && p.summary !== "")).toBe(true);
    expect(de.every((p) => !p.fallback && p.summary !== "")).toBe(true);
    expect(de.map((p) => p.slug)).toEqual(en.map((p) => p.slug));
  });
});

describe("markdown subset", () => {
  it("parses headings, paragraphs, lists and quotes", () => {
    const blocks = parseMarkdown(
      "## Title\n\nFirst line\nsecond line.\n\n- one\n- two\n\n> quoted\n\n### Small"
    );
    expect(blocks.map((b) => b.type)).toEqual(["h2", "p", "ul", "quote", "h3"]);
    expect(blocks[1]).toEqual({
      type: "p",
      content: [{ type: "text", text: "First line second line." }],
    });
  });

  it("keeps only safe links and parses emphasis", () => {
    expect(
      parseInline(
        "**bold** and *soft* [ok](https://a.test) [in](/news) [no](javascript:void)"
      )
    ).toEqual([
      { type: "strong", text: "bold" },
      { type: "text", text: " and " },
      { type: "em", text: "soft" },
      { type: "text", text: " " },
      { type: "link", text: "ok", href: "https://a.test" },
      { type: "text", text: " " },
      { type: "link", text: "in", href: "/news" },
      { type: "text", text: " " },
      { type: "text", text: "no" },
    ]);
  });
});
