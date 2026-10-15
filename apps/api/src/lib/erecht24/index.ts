/**
 * eRecht24 Rechtstexte-API v2 (P-025, ROADMAP P10): read-only HTTP client, date and HTML
 * helpers, the sanitiser for the delivered HTML and the mapping between contract types
 * (`privacy-policy`) and eRecht24 types (`privacyPolicy`). The legal service caches on top.
 */
export { createErecht24Client, ERECHT24_DEFAULT_BASE_URL } from "./client.ts";
export { berlinOffsetMinutes, parseErecht24Date } from "./dates.ts";
export { decodeHtmlEntities, emptyToNull, htmlToLines } from "./html.ts";
export { isAllowedHref, sanitizeLegalHtml } from "./sanitize.ts";
export {
  ERECHT24_DOCUMENT_TYPES,
  type Erecht24Client,
  type Erecht24ClientOptions,
  type Erecht24Document,
  Erecht24DocumentPayload,
  Erecht24DocumentType,
  Erecht24ErrorPayload,
  type FetchLike,
  toErecht24DocumentType,
} from "./types.ts";
