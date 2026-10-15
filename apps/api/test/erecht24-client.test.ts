import { describe, expect, it } from "bun:test";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  berlinOffsetMinutes,
  createErecht24Client,
  ERECHT24_DOCUMENT_TYPES,
  type Erecht24ClientOptions,
  type FetchLike,
  htmlToLines,
  parseErecht24Date,
  toErecht24DocumentType,
} from "../src/lib/erecht24/index.ts";
import { ApiError } from "../src/lib/errors.ts";

/* ---------- fixtures ---------- */

const BASE_URL = "https://erecht24.test/v2";
const API_KEY = "test-project-key-not-a-real-key-0000000000000000000000000000";
const PLUGIN_KEY = "test-plugin-key-not-a-real-key";

/** Shape of the live demo imprint (dates as wall clock, entities in the HTML). */
const IMPRINT_PAYLOAD = {
  html_de:
    "<h1>Impressum</h1>\n<p>Max Mustermann<br />\nMusterstra&szlig;e 111</p>",
  html_en: "<h1>Site Notice</h1>\n<p>Max Mustermann</p>",
  created: "2020-03-29 20:18:19",
  modified: "2026-01-15 12:00:00",
  pushed: "2026-03-27T07:39:07.000000Z",
  warnings: "",
};

interface RecordedCall {
  headers: Record<string, string>;
  method: string;
  signal: AbortSignal | null | undefined;
  url: URL;
}

/** A fetch stand-in that records every call and answers through `handler`. */
function fakeFetch(
  handler: (call: RecordedCall) => Response | Promise<Response>
) {
  const calls: RecordedCall[] = [];
  const fetchLike: FetchLike = (input, init) => {
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      signal: init?.signal,
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetch: fetchLike, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const client = (
  fetch: FetchLike,
  overrides: Partial<Erecht24ClientOptions> = {}
) =>
  createErecht24Client({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    pluginKey: PLUGIN_KEY,
    fetch,
    timeoutMs: 2000,
    ...overrides,
  });

async function expectApiError(
  promise: Promise<unknown>,
  code: string,
  status?: ContentfulStatusCode
): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const apiError = err as ApiError;
    expect(apiError.code).toBe(code);
    if (status !== undefined) {
      expect(apiError.status).toBe(status);
    }
    return apiError;
  }
  throw new Error(`expected ApiError ${code}`);
}

/* ---------- documents ---------- */

describe("erecht24 client: documents", () => {
  it("fetches the imprint with both keys and normalises the payload", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, IMPRINT_PAYLOAD));
    const doc = await client(fetch).getDocument("imprint");

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url.toString()).toBe(`${BASE_URL}/imprint`);
    expect(call?.method).toBe("GET");
    expect(call?.headers["erecht24-api-key"]).toBe(API_KEY);
    expect(call?.headers["erecht24-plugin-key"]).toBe(PLUGIN_KEY);
    expect(call?.headers.accept).toBe("application/json");
    expect(call?.signal).toBeInstanceOf(AbortSignal);

    expect(doc.htmlDe).toBe(IMPRINT_PAYLOAD.html_de);
    expect(doc.htmlEn).toBe(IMPRINT_PAYLOAD.html_en);
    expect(doc.createdAt?.toISOString()).toBe("2020-03-29T18:18:19.000Z");
    expect(doc.modifiedAt?.toISOString()).toBe("2026-01-15T11:00:00.000Z");
    expect(doc.warnings).toEqual([]);
  });

  it("maps each document type to its endpoint", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, IMPRINT_PAYLOAD));
    const api = client(fetch);
    for (const type of ERECHT24_DOCUMENT_TYPES) {
      await api.getDocument(type);
    }
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v2/imprint",
      "/v2/privacyPolicy",
      "/v2/privacyPolicySocialMedia",
    ]);
  });

  it("tolerates a trailing slash in the base URL", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, IMPRINT_PAYLOAD));
    await client(fetch, { baseUrl: `${BASE_URL}/` }).getDocument(
      "privacyPolicy"
    );
    expect(calls[0]?.url.toString()).toBe(`${BASE_URL}/privacyPolicy`);
  });

  it("turns empty or missing HTML into null and strips the warnings HTML", async () => {
    const { fetch } = fakeFetch(() =>
      json(200, {
        html_de: "<p>Nur Deutsch</p>",
        html_en: "",
        created: null,
        modified: "0000-00-00 00:00:00",
        warnings:
          "<ul><li>Bitte <b>Adresse</b> erg&auml;nzen.</li><li>Zweite &amp; Zeile<br>Dritte &#8211; Zeile</li></ul>",
      })
    );
    const doc = await client(fetch).getDocument("privacyPolicySocialMedia");
    expect(doc.htmlDe).toBe("<p>Nur Deutsch</p>");
    expect(doc.htmlEn).toBeNull();
    expect(doc.createdAt).toBeNull();
    expect(doc.modifiedAt).toBeNull();
    expect(doc.warnings).toEqual([
      "Bitte Adresse ergänzen.",
      "Zweite & Zeile",
      "Dritte – Zeile",
    ]);
  });

  it("reports a text that does not exist yet as erecht24_not_found", async () => {
    const { fetch } = fakeFetch(() =>
      json(404, {
        message:
          "Imprint not found. Maybe there is no imprint for the project yet.",
        message_de: "Impressum nicht gefunden.",
        error_code: 1_649_943_249,
        faq_link: "https://www.e-recht24.de/faq#1649943249",
      })
    );
    const err = await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_not_found",
      404
    );
    expect(err.message).toContain("Imprint not found");
    expect(err.extra).toEqual({
      upstreamStatus: 404,
      upstreamErrorCode: 1_649_943_249,
    });
  });

  it("maps 401 to erecht24_unauthorized without echoing the key", async () => {
    const { fetch } = fakeFetch(() =>
      json(401, {
        message: "Invalid API key and/or Plugin key for the eRecht24 API.",
        error_code: 1_649_852_368,
        debug: { token: API_KEY },
      })
    );
    const err = await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_unauthorized",
      502
    );
    const visible = JSON.stringify({ message: err.message, extra: err.extra });
    expect(visible).not.toContain(API_KEY);
  });

  it("maps 403 (key not allowed) to erecht24_unauthorized", async () => {
    const { fetch } = fakeFetch(() => json(403, { message: "Forbidden" }));
    await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_unauthorized",
      502
    );
  });

  it("maps 503 to erecht24_unavailable", async () => {
    const { fetch } = fakeFetch(() =>
      json(503, { message: "A connection could not be established." })
    );
    await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_unavailable",
      502
    );
  });

  it("maps a network failure to erecht24_unavailable and keeps the cause", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_unavailable",
      502
    );
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it("aborts after timeoutMs and reports erecht24_unavailable", async () => {
    const { fetch } = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () =>
            reject(call.signal?.reason)
          );
        })
    );
    const err = await expectApiError(
      client(fetch, { timeoutMs: 20 }).getDocument("imprint"),
      "erecht24_unavailable",
      502
    );
    expect(err.message).toContain("in time");
    expect((err.cause as Error).name).toBe("TimeoutError");
  });

  it("rejects invalid JSON with erecht24_bad_response", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    );
    await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_bad_response",
      502
    );
  });

  it("maps a non-JSON error page by status alone", async () => {
    const { fetch } = fakeFetch(
      () => new Response("<html>502 Bad Gateway</html>", { status: 502 })
    );
    await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_unavailable",
      502
    );
  });

  it("rejects a payload with the wrong shape with erecht24_bad_response", async () => {
    const { fetch } = fakeFetch(() => json(200, { html_de: 42 }));
    await expectApiError(
      client(fetch).getDocument("imprint"),
      "erecht24_bad_response",
      502
    );
  });

  it("throws erecht24_not_configured without calling fetch unless both keys are set", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, IMPRINT_PAYLOAD));
    for (const keys of [
      { apiKey: "  " },
      { pluginKey: "" },
      { apiKey: "", pluginKey: "" },
    ]) {
      const api = client(fetch, keys);
      expect(api.configured).toBe(false);
      await expectApiError(
        api.getDocument("imprint"),
        "erecht24_not_configured",
        503
      );
    }
    expect(client(fetch).configured).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

/* ---------- helpers ---------- */

describe("erecht24 helpers", () => {
  it("maps contract types to eRecht24 types", () => {
    expect(toErecht24DocumentType("imprint")).toBe("imprint");
    expect(toErecht24DocumentType("privacy-policy")).toBe("privacyPolicy");
    expect(toErecht24DocumentType("privacy-policy-social-media")).toBe(
      "privacyPolicySocialMedia"
    );
  });

  it("parses Berlin wall-clock times in winter and summer", () => {
    expect(berlinOffsetMinutes(Date.UTC(2026, 0, 15, 11))).toBe(60);
    expect(berlinOffsetMinutes(Date.UTC(2026, 6, 15, 10))).toBe(120);
    expect(parseErecht24Date("2026-01-15 12:00:00")?.toISOString()).toBe(
      "2026-01-15T11:00:00.000Z"
    );
    expect(parseErecht24Date("2026-07-15 12:00:00")?.toISOString()).toBe(
      "2026-07-15T10:00:00.000Z"
    );
    expect(parseErecht24Date("2026-07-15 12:00")?.toISOString()).toBe(
      "2026-07-15T10:00:00.000Z"
    );
  });

  it("handles the DST switches (last Sundays of March and October)", () => {
    expect(parseErecht24Date("2026-03-29 01:59:59")?.toISOString()).toBe(
      "2026-03-29T00:59:59.000Z"
    );
    expect(parseErecht24Date("2026-03-29 03:00:00")?.toISOString()).toBe(
      "2026-03-29T01:00:00.000Z"
    );
    expect(parseErecht24Date("2026-10-24 12:00:00")?.toISOString()).toBe(
      "2026-10-24T10:00:00.000Z"
    );
    expect(parseErecht24Date("2026-10-25 04:00:00")?.toISOString()).toBe(
      "2026-10-25T03:00:00.000Z"
    );
    expect(parseErecht24Date("2026-10-25 02:30:00")?.toISOString()).toBe(
      "2026-10-25T01:30:00.000Z"
    );
  });

  it("accepts ISO timestamps with zone and rejects placeholders", () => {
    expect(
      parseErecht24Date("2026-03-27T07:39:07.000000Z")?.toISOString()
    ).toBe("2026-03-27T07:39:07.000Z");
    expect(parseErecht24Date("2026-03-27T09:39:07+02:00")?.toISOString()).toBe(
      "2026-03-27T07:39:07.000Z"
    );
    expect(parseErecht24Date("")).toBeNull();
    expect(parseErecht24Date(null)).toBeNull();
    expect(parseErecht24Date(undefined)).toBeNull();
    expect(parseErecht24Date("0000-00-00 00:00:00")).toBeNull();
    expect(parseErecht24Date("2026-02-30 10:00:00")).toBeNull();
    expect(parseErecht24Date("yesterday")).toBeNull();
  });

  it("converts warning HTML into plain text lines", () => {
    expect(htmlToLines(null)).toEqual([]);
    expect(htmlToLines("")).toEqual([]);
    expect(htmlToLines("<p>  </p>")).toEqual([]);
    expect(
      htmlToLines(
        '<p>Bitte <a href="https://example.com">Adresse</a> pr&uuml;fen.</p>\n<p>Stra&szlig;e &amp; Hausnummer<br/>fehlen &#x00A7; 5 &#64;</p>'
      )
    ).toEqual(["Bitte Adresse prüfen.", "Straße & Hausnummer", "fehlen § 5 @"]);
    expect(htmlToLines("&lt;b&gt; bleibt Text &unknown;")).toEqual([
      "<b> bleibt Text &unknown;",
    ]);
  });
});
