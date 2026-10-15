import { z } from "zod";
import { IsoDateTime } from "./common.ts";

/**
 * Legal texts (imprint, privacy policy) come from the eRecht24 project manager via the
 * Rechtstexte-API v2. The Soulwick API pulls them on demand, sanitises the HTML and caches it in
 * memory (24 h, failures 60 s; P-025). The website renders the HTML and falls back to a
 * placeholder while `status` is "missing" or the request fails (502 `erecht24_*`).
 */
export const LegalDocumentType = z.enum([
  "imprint",
  "privacy-policy",
  "privacy-policy-social-media",
]);
export type LegalDocumentType = z.infer<typeof LegalDocumentType>;

export const LegalLocale = z.enum(["de", "en"]);
export type LegalLocale = z.infer<typeof LegalLocale>;

/** GET /legal/:type */
export const LegalDocumentResponse = z.object({
  type: LegalDocumentType,
  /**
   * ready = a text exists; missing = no text (the eRecht24 keys are not configured or the
   * eRecht24 project has no such text yet).
   */
  status: z.enum(["ready", "missing"]),
  html: z.object({ de: z.string().nullable(), en: z.string().nullable() }),
  /** Last change inside the eRecht24 project (`modified`). */
  sourceModifiedAt: IsoDateTime.nullable(),
  /** When the Soulwick API last pulled the text from eRecht24 (null without keys). */
  fetchedAt: IsoDateTime.nullable(),
  /** Hints from eRecht24 (e.g. missing address), plain text lines. */
  warnings: z.array(z.string()),
});
export type LegalDocumentResponse = z.infer<typeof LegalDocumentResponse>;
