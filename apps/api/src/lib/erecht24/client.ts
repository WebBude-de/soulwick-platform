import { ApiError, withCause } from "../errors.ts";
import { parseErecht24Date } from "./dates.ts";
import { emptyToNull, htmlToLines } from "./html.ts";
import {
  type Erecht24Client,
  type Erecht24ClientOptions,
  type Erecht24Document,
  Erecht24DocumentPayload,
  type Erecht24DocumentType,
  Erecht24ErrorPayload,
  type FetchLike,
} from "./types.ts";

export const ERECHT24_DEFAULT_BASE_URL = "https://api.e-recht24.de/v2";
const DEFAULT_TIMEOUT_MS = 10_000;
const API_KEY_HEADER = "eRecht24-api-key";
const PLUGIN_KEY_HEADER = "eRecht24-plugin-key";
const HTTP_SERVER_ERROR = 500;
const TRAILING_SLASHES = /\/+$/;

/**
 * Maps a non-2xx eRecht24 answer to a stable ApiError. Only the English `message` is passed
 * on; the payload's `debug` block (which can echo the API key) is never read.
 */
function upstreamError(
  status: number,
  payload: Erecht24ErrorPayload | null
): ApiError {
  const detail = payload?.message?.trim();
  const extra: Record<string, unknown> = { upstreamStatus: status };
  if (payload?.error_code) {
    extra.upstreamErrorCode = payload.error_code;
  }
  const fail = (ourStatus: 404 | 502, code: string, fallback: string) =>
    new ApiError(ourStatus, code, detail || fallback, extra);

  switch (status) {
    case 401:
    case 403:
      return fail(
        502,
        "erecht24_unauthorized",
        "eRecht24 rejected the API or plugin key"
      );
    case 404:
      return fail(404, "erecht24_not_found", "eRecht24 has no such text yet");
    case 400:
    case 422:
      return fail(502, "erecht24_bad_request", "eRecht24 rejected the request");
    case 503:
      return fail(
        502,
        "erecht24_unavailable",
        "eRecht24 is temporarily unavailable"
      );
    default:
      return fail(
        502,
        status >= HTTP_SERVER_ERROR
          ? "erecht24_unavailable"
          : "erecht24_bad_response",
        `Unexpected eRecht24 response (HTTP ${status})`
      );
  }
}

function toDocument(raw: Erecht24DocumentPayload): Erecht24Document {
  return {
    htmlDe: emptyToNull(raw.html_de),
    htmlEn: emptyToNull(raw.html_en),
    createdAt: parseErecht24Date(raw.created),
    modifiedAt: parseErecht24Date(raw.modified),
    warnings: htmlToLines(raw.warnings),
  };
}

/**
 * HTTP client for the eRecht24 Rechtstexte-API v2 (read only, like DapItUp: P-025). Pure
 * transport: no caching, no logging (the keys must never end up in a log line), no database.
 * Both keys are sent on every call. Every failure is an `ApiError` with an `erecht24_*` code.
 */
export function createErecht24Client(
  options: Erecht24ClientOptions
): Erecht24Client {
  const baseUrl = options.baseUrl.replace(TRAILING_SLASHES, "");
  const apiKey = options.apiKey.trim();
  const pluginKey = options.pluginKey.trim();
  const doFetch: FetchLike = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const configured = apiKey.length > 0 && pluginKey.length > 0;

  async function get(path: string): Promise<unknown> {
    if (!configured) {
      throw new ApiError(
        503,
        "erecht24_not_configured",
        "ERECHT24_API_KEY and ERECHT24_PLUGIN_KEY must both be set"
      );
    }
    // Own timer instead of AbortSignal.timeout(): it is cleared as soon as the answer is in,
    // and a plain setTimeout also fires when nothing else keeps the event loop busy (Bun).
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new DOMException("eRecht24 request timed out", "TimeoutError")
      );
    }, timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          [API_KEY_HEADER]: apiKey,
          [PLUGIN_KEY_HEADER]: pluginKey,
        },
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      throw withCause(
        new ApiError(
          502,
          "erecht24_unavailable",
          timedOut
            ? "eRecht24 did not answer in time"
            : "eRecht24 could not be reached"
        ),
        err
      );
    } finally {
      clearTimeout(timer);
    }

    let data: unknown = null;
    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text);
      } catch (err) {
        if (response.ok) {
          throw withCause(
            new ApiError(
              502,
              "erecht24_bad_response",
              "eRecht24 returned invalid JSON"
            ),
            err
          );
        }
        // Non-JSON error pages (proxies, maintenance) are mapped by status alone.
      }
    }
    if (!response.ok) {
      const parsed = Erecht24ErrorPayload.safeParse(data);
      throw upstreamError(response.status, parsed.success ? parsed.data : null);
    }
    return data;
  }

  return {
    configured,

    async getDocument(type: Erecht24DocumentType) {
      const result = Erecht24DocumentPayload.safeParse(await get(`/${type}`));
      if (!result.success) {
        throw withCause(
          new ApiError(
            502,
            "erecht24_bad_response",
            `Unexpected eRecht24 ${type} payload`
          ),
          result.error
        );
      }
      return toDocument(result.data);
    },
  };
}
