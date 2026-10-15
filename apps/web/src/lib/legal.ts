import "server-only";
import type {
  LegalDocumentResponse,
  LegalDocumentType,
  LegalLocale,
} from "@soulwick/contracts";
import { type ApiResult, apiGet } from "@/lib/api";

/** Legal texts change rarely; the API itself refreshes them from eRecht24 every 24 h. */
export const LEGAL_REVALIDATE_SECONDS = 300;

/** The two documents the website shows (the social-media variant is not needed here). */
export type LegalPageType = Extract<
  LegalDocumentType,
  "imprint" | "privacy-policy"
>;

/** `GET /legal/:type` (P-013). Never throws; a missing route (404) is reported like `missing`. */
export function getLegalDocument(
  type: LegalPageType
): Promise<ApiResult<LegalDocumentResponse>> {
  return apiGet<LegalDocumentResponse>(
    `/legal/${type}`,
    LEGAL_REVALIDATE_SECONDS
  );
}

export type LegalView =
  | {
      state: "ready";
      html: string;
      /** Locale of the HTML actually shown (may differ from the page locale). */
      htmlLocale: LegalLocale;
      /** True when the page locale had no text and the other one is shown instead. */
      fallback: boolean;
      modifiedAt: string | null;
      warnings: string[];
    }
  | { state: "missing"; reason: "missing" | "unreachable" };

/** Picks the HTML to show for `locale`: own locale first, the other locale as a marked fallback. */
export function resolveLegalView(
  result: ApiResult<LegalDocumentResponse>,
  locale: LegalLocale
): LegalView {
  if (!result.ok) {
    return {
      state: "missing",
      reason: result.status === "unreachable" ? "unreachable" : "missing",
    };
  }
  const doc = result.data;
  if (doc.status !== "ready") {
    return { state: "missing", reason: "missing" };
  }
  const other: LegalLocale = locale === "de" ? "en" : "de";
  const own = nonEmpty(doc.html[locale]);
  const alt = nonEmpty(doc.html[other]);
  if (own) {
    return ready(doc, own, locale, false);
  }
  if (alt) {
    return ready(doc, alt, other, true);
  }
  return { state: "missing", reason: "missing" };
}

function ready(
  doc: LegalDocumentResponse,
  html: string,
  htmlLocale: LegalLocale,
  fallback: boolean
): LegalView {
  return {
    state: "ready",
    html,
    htmlLocale,
    fallback,
    modifiedAt: doc.sourceModifiedAt,
    warnings: doc.warnings,
  };
}

function nonEmpty(value: string | null): string | null {
  return value && value.trim().length > 0 ? value : null;
}
