import type {
  LegalDocumentResponse,
  LegalDocumentType,
} from "@soulwick/contracts";
import {
  createErecht24Client,
  type Erecht24Client,
  type Erecht24Document,
  emptyToNull,
  sanitizeLegalHtml,
  toErecht24DocumentType,
} from "../lib/erecht24/index.ts";
import { ApiError } from "../lib/errors.ts";
import { createLogger, type Logger } from "../lib/logger.ts";
import { isoOrNull } from "../lib/validate.ts";
import type { BaseDeps } from "../types.ts";

/**
 * Legal texts from eRecht24 like DapItUp (P-025): pulled on demand, cached in memory only.
 * Successful answers are kept for 24 h, failures (and texts eRecht24 does not have yet) for
 * 60 s, so an outage does not hammer eRecht24 and recovery is quick. No database table, no
 * push clients, no admin functions.
 */
export const LEGAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const LEGAL_FAILURE_TTL_MS = 60 * 1000;
const ERECHT24_TIMEOUT_MS = 10_000;

export interface LegalService {
  /** Both ERECHT24_API_KEY and ERECHT24_PLUGIN_KEY are set. */
  readonly configured: boolean;
  /**
   * The text of `type`. Without both keys: `status: "missing"` without calling eRecht24.
   * Throws the `erecht24_*` ApiError of a failed pull unless an earlier text is still known.
   */
  getDocument: (type: LegalDocumentType) => Promise<LegalDocumentResponse>;
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<LegalDocumentResponse>;
}

/** No text: no keys configured (`fetchedAt` null) or eRecht24 has none yet (`fetchedAt` set). */
export const missingLegalDocument = (
  type: LegalDocumentType,
  fetchedAt: Date | null
): LegalDocumentResponse => ({
  type,
  status: "missing",
  html: { de: null, en: null },
  sourceModifiedAt: null,
  fetchedAt: isoOrNull(fetchedAt),
  warnings: [],
});

const cleanHtml = (html: string | null): string | null =>
  html === null ? null : emptyToNull(sanitizeLegalHtml(html));

/** Sanitised response; a document whose HTML is empty after cleaning counts as missing. */
export function toLegalDocumentResponse(
  type: LegalDocumentType,
  doc: Erecht24Document,
  fetchedAt: Date
): LegalDocumentResponse {
  const de = cleanHtml(doc.htmlDe);
  const en = cleanHtml(doc.htmlEn);
  if (!(de || en)) {
    return missingLegalDocument(type, fetchedAt);
  }
  return {
    type,
    status: "ready",
    html: { de, en },
    sourceModifiedAt: isoOrNull(doc.modifiedAt),
    fetchedAt: isoOrNull(fetchedAt),
    warnings: doc.warnings,
  };
}

function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof ApiError) {
    return { code: err.code, error: err.message };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

function createLegalService(deps: BaseDeps): LegalService {
  const { config } = deps;
  const logger: Logger = createLogger(config.LOG_LEVEL);
  const now = () => deps.now?.() ?? new Date();
  const client: Erecht24Client = createErecht24Client({
    baseUrl: config.ERECHT24_API_URL,
    apiKey: config.ERECHT24_API_KEY,
    pluginKey: config.ERECHT24_PLUGIN_KEY,
    fetch: deps.fetch,
    timeoutMs: ERECHT24_TIMEOUT_MS,
  });
  /** Per type: the pending or settled pull. The pending promise is shared by parallel readers. */
  const cache = new Map<LegalDocumentType, CacheEntry>();
  /** Last ready text per type: served while a later pull fails, like the old database cache. */
  const lastReady = new Map<LegalDocumentType, LegalDocumentResponse>();

  async function pull(
    type: LegalDocumentType,
    fetchedAt: Date
  ): Promise<LegalDocumentResponse> {
    try {
      const doc = await client.getDocument(toErecht24DocumentType(type));
      return toLegalDocumentResponse(type, doc, fetchedAt);
    } catch (err) {
      if (err instanceof ApiError && err.code === "erecht24_not_found") {
        logger.info("legal_document_not_created", { type });
        return missingLegalDocument(type, fetchedAt);
      }
      throw err;
    }
  }

  return {
    configured: client.configured,

    getDocument(type) {
      if (!client.configured) {
        return Promise.resolve(missingLegalDocument(type, null));
      }
      const pulledAt = now();
      const t = pulledAt.getTime();
      const hit = cache.get(type);
      if (hit && hit.expiresAt > t) {
        return hit.value;
      }
      /** Shortens the entry of this pull to the failure TTL (if it is still the current one). */
      const expireSoon = () => {
        const entry = cache.get(type);
        if (entry?.value === value) {
          entry.expiresAt = t + LEGAL_FAILURE_TTL_MS;
        }
      };
      const value: Promise<LegalDocumentResponse> = pull(type, pulledAt).then(
        (doc) => {
          if (doc.status === "ready") {
            lastReady.set(type, doc);
          } else {
            expireSoon();
          }
          return doc;
        },
        (err: unknown) => {
          expireSoon();
          logger.error("legal_refresh_failed", { type, ...errorFields(err) });
          const stale = lastReady.get(type);
          if (stale) {
            return stale;
          }
          throw err;
        }
      );
      cache.set(type, { expiresAt: t + LEGAL_CACHE_TTL_MS, value });
      return value;
    },
  };
}

const services = new WeakMap<BaseDeps["config"], LegalService>();

/**
 * One service (and so one cache) per app, keyed by its config object (createApp wraps the deps it
 * gets, the config stays the same object); tests get a fresh one per app.
 */
export function legalService(deps: BaseDeps): LegalService {
  let service = services.get(deps.config);
  if (!service) {
    service = createLegalService(deps);
    services.set(deps.config, service);
  }
  return service;
}
