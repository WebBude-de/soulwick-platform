import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LegalLocale } from "@soulwick/contracts";
import type { LegalView } from "@/lib/legal";

/** The two legal pages of the website, named like their routes. */
export type LegalFileKind = "imprint" | "privacy";

/**
 * `apps/web/content/legal`: the working directory of `next dev`, `next start` and of the standalone
 * server (`server.js` changes into `apps/web`). The folder is traced into the standalone output
 * (`outputFileTracingIncludes` in `next.config.ts`).
 */
export function legalContentDir(): string {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "content",
    "legal"
  );
}

/**
 * Optional local fallback `<kind>.<locale>.html` (e.g. `imprint.de.html`). Null when the file
 * does not exist, cannot be read or is empty. Never throws.
 */
export async function readLegalFile(
  kind: LegalFileKind,
  locale: LegalLocale,
  dir: string = legalContentDir()
): Promise<string | null> {
  try {
    const html = await readFile(
      path.join(dir, `${kind}.${locale}.html`),
      "utf8"
    );
    return html.trim().length > 0 ? html : null;
  } catch {
    return null;
  }
}

/**
 * Keeps a text from the API; otherwise shows the local file for the page locale, then the file of
 * the other locale (marked as fallback). Without any file the placeholder view stays.
 */
export async function withLegalFileFallback(
  view: LegalView,
  kind: LegalFileKind,
  locale: LegalLocale,
  dir: string = legalContentDir()
): Promise<LegalView> {
  if (view.state === "ready") {
    return view;
  }
  const other: LegalLocale = locale === "de" ? "en" : "de";
  const [own, alt] = await Promise.all([
    readLegalFile(kind, locale, dir),
    readLegalFile(kind, other, dir),
  ]);
  const html = own ?? alt;
  if (!html) {
    return view;
  }
  return {
    state: "ready",
    html,
    htmlLocale: own ? locale : other,
    fallback: !own,
    modifiedAt: null,
    warnings: [],
  };
}
