import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { LOCALES, type Locale } from "@/i18n/locale";

/**
 * News posts (devlog) live as Markdown files in the repo, one folder per post:
 * `content/news/<slug>/<locale>.md` with a small front matter block (see the README there).
 * `/news` and `/news/<slug>` are built from them ahead of time; the landing page and the sitemap
 * read them while rendering. Posts only change with a deploy, so a production server reads each
 * file once and keeps the result (development reads fresh, so a new post shows up at once). The
 * folder is traced into the standalone build (`next.config.ts`).
 */

export interface NewsMeta {
  /** ISO day, `YYYY-MM-DD`. */
  date: string;
  /** The post is shown in another language than the page (no file for the page language). */
  fallback: boolean;
  /** Optional cover in `public/` (e.g. `/brand/news/<slug>.webp`), only used when it exists. */
  image: string | null;
  /** Language of the text actually shown. */
  locale: Locale;
  slug: string;
  summary: string;
  title: string;
}

export interface NewsPost extends NewsMeta {
  body: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FIELD = /^([a-zA-Z]+):\s*(.*)$/;
const LINE_BREAK = /\r?\n/;
const BOM = /^﻿/;

/** `apps/web/content/news` (working directory of dev, start and the standalone server). */
export function newsContentDir(): string {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "content",
    "news"
  );
}

export function isNewsSlug(value: string): boolean {
  return SLUG.test(value);
}

interface ParsedFile {
  body: string;
  date: string;
  draft: boolean;
  image: string | null;
  summary: string;
  title: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

/**
 * Splits a post file into front matter and body. Returns `null` when the front matter is
 * missing or lacks `title` or a valid `date`, so a broken file is skipped instead of crashing
 * the page.
 */
export function parseNewsFile(source: string): ParsedFile | null {
  const match: RegExpExecArray | null = FRONT_MATTER.exec(
    source.replace(BOM, "")
  );
  if (match === null) {
    return null;
  }
  const [, head = "", body = ""] = match;
  const fields: Partial<Record<string, string>> = {};
  for (const line of head.split(LINE_BREAK)) {
    const field: RegExpExecArray | null = FIELD.exec(line.trim());
    if (field !== null) {
      fields[(field[1] ?? "").toLowerCase()] = unquote(field[2] ?? "");
    }
  }
  const title = fields.title ?? "";
  const date = fields.date ?? "";
  if (title === "" || !DAY.test(date)) {
    return null;
  }
  const image = fields.image ?? "";
  return {
    title,
    date,
    summary: fields.summary ?? "",
    draft: fields.draft === "true",
    image: image.startsWith("/") ? image : null,
    body: body.trim(),
  };
}

/** Results per folder, slug and language; only filled in production (see above). */
const memo = new Map<string, Promise<unknown>>();

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== "production") {
    return load();
  }
  let entry = memo.get(key) as Promise<T> | undefined;
  if (!entry) {
    entry = load();
    memo.set(key, entry);
  }
  return entry;
}

function readPost(
  dir: string,
  slug: string,
  locale: Locale
): Promise<NewsPost | null> {
  return remember(`post|${dir}|${slug}|${locale}`, () =>
    loadPost(dir, slug, locale)
  );
}

async function loadPost(
  dir: string,
  slug: string,
  locale: Locale
): Promise<NewsPost | null> {
  // The page language first, then the others; read in parallel, first file found wins.
  const order = [locale, ...LOCALES.filter((other) => other !== locale)];
  const sources = await Promise.all(
    order.map((lang) =>
      readFile(path.join(dir, slug, `${lang}.md`), "utf8").catch(() => null)
    )
  );
  const index = sources.findIndex((text) => text !== null);
  const source = sources[index];
  const candidate = order[index];
  if (source === undefined || source === null || candidate === undefined) {
    return null;
  }
  const parsed = parseNewsFile(source);
  if (!parsed || parsed.draft) {
    return null;
  }
  return {
    slug,
    title: parsed.title,
    date: parsed.date,
    summary: parsed.summary,
    image: parsed.image,
    body: parsed.body,
    locale: candidate,
    fallback: candidate !== locale,
  };
}

/** All published posts, newest first, in the page language where available. Never throws. */
export function listNews(
  locale: Locale,
  dir: string = newsContentDir()
): Promise<NewsMeta[]> {
  return remember(`list|${dir}|${locale}`, () => loadList(locale, dir));
}

async function loadList(locale: Locale, dir: string): Promise<NewsMeta[]> {
  let slugs: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    slugs = entries
      .filter((entry) => entry.isDirectory() && isNewsSlug(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const posts = await Promise.all(
    slugs.map((slug) => readPost(dir, slug, locale))
  );
  return posts
    .filter((post): post is NewsPost => post !== null)
    .map(({ body: _body, ...meta }) => meta)
    .sort(
      (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
    );
}

/** One post in the page language (or the other one as fallback), `null` if unknown. */
export function getNews(
  slug: string,
  locale: Locale,
  dir: string = newsContentDir()
): Promise<NewsPost | null> {
  if (!isNewsSlug(slug)) {
    return Promise.resolve(null);
  }
  return readPost(dir, slug, locale);
}

/** Long date in the page language, e.g. „17. Oktober 2026“ / "October 17, 2026". */
export function formatNewsDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
