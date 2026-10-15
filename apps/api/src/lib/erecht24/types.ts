import type { LegalDocumentType } from "@soulwick/contracts";
import { z } from "zod";

/** Document endpoints of the eRecht24 Rechtstexte-API v2 (`GET /<type>`). */
export const Erecht24DocumentType = z.enum([
  "imprint",
  "privacyPolicy",
  "privacyPolicySocialMedia",
]);
export type Erecht24DocumentType = z.infer<typeof Erecht24DocumentType>;
export const ERECHT24_DOCUMENT_TYPES = Erecht24DocumentType.options;

/* ---------- type mapping: contract (kebab-case) -> eRecht24 (camelCase) ---------- */

const LEGAL_TO_ERECHT24: Record<LegalDocumentType, Erecht24DocumentType> = {
  imprint: "imprint",
  "privacy-policy": "privacyPolicy",
  "privacy-policy-social-media": "privacyPolicySocialMedia",
};

/** Contract type (`GET /legal/:type`) -> eRecht24 endpoint. */
export const toErecht24DocumentType = (
  type: LegalDocumentType
): Erecht24DocumentType => LEGAL_TO_ERECHT24[type];

/* ---------- raw payloads (snake_case, exactly as eRecht24 sends them) ---------- */

/** eRecht24 omits, nulls or empties optional strings depending on the project state. */
const text = z.string().nullish();

/** `GET /imprint`, `/privacyPolicy`, `/privacyPolicySocialMedia` (200). */
export const Erecht24DocumentPayload = z.object({
  html_de: text,
  html_en: text,
  /** `YYYY-MM-DD HH:MM:SS` in Europe/Berlin. */
  created: text,
  /** `YYYY-MM-DD HH:MM:SS` in Europe/Berlin. */
  modified: text,
  /** Observed as ISO 8601 with zone, unlike `created`/`modified`. */
  pushed: text,
  /** HTML fragment with hints for the project owner, e.g. a missing address. */
  warnings: text,
});
export type Erecht24DocumentPayload = z.infer<typeof Erecht24DocumentPayload>;

/**
 * Error body for 4xx/5xx. The 401 variant carries a `debug.token` field that echoes the sent
 * key; it is deliberately not part of this schema and never forwarded.
 */
export const Erecht24ErrorPayload = z.object({
  message: text,
  message_de: text,
  error_code: z.coerce.number().int().nullish(),
  faq_link: text,
});
export type Erecht24ErrorPayload = z.infer<typeof Erecht24ErrorPayload>;

/* ---------- normalised shapes used by the rest of the API ---------- */

export interface Erecht24Document {
  createdAt: Date | null;
  /** Raw HTML as sent; null when eRecht24 sent no or an empty German text. */
  htmlDe: string | null;
  /** Raw HTML as sent; null when eRecht24 sent no or an empty English text. */
  htmlEn: string | null;
  modifiedAt: Date | null;
  /** Hints from eRecht24 as plain text lines (HTML stripped, entities decoded). */
  warnings: string[];
}

/** Structural fetch type so tests can inject a plain function (Bun's `typeof fetch` has statics). */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface Erecht24ClientOptions {
  /** Project API key from the eRecht24 Projekt-Manager. */
  apiKey: string;
  /** e.g. `https://api.e-recht24.de/v2`; a trailing slash is tolerated. */
  baseUrl: string;
  /** Defaults to the global fetch; injected in tests. */
  fetch?: FetchLike;
  /** Developer/plugin key issued by eRecht24. */
  pluginKey: string;
  /** Per request; defaults to 10 s. */
  timeoutMs?: number;
}

export interface Erecht24Client {
  /** false unless both keys are set: every call then throws `erecht24_not_configured`. */
  readonly configured: boolean;
  getDocument: (type: Erecht24DocumentType) => Promise<Erecht24Document>;
}
