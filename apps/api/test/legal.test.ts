import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createApp } from "../src/app.ts";
import {
  LEGAL_CACHE_TTL_MS,
  LEGAL_FAILURE_TTL_MS,
  legalService,
} from "../src/services/legal.ts";
import type { BaseDeps } from "../src/types.ts";
import { createTestContext, type TestContext, testConfig } from "./helpers.ts";

/**
 * GET /legal/:type like DapItUp (P-025): pull on demand with both keys, sanitise, cache in
 * memory (24 h, failures 60 s), share a running pull. The service never touches the database.
 */

const BASE_URL = "https://erecht24.test/v2";
const API_KEY = "test-project-key-not-a-real-key";
const PLUGIN_KEY = "test-plugin-key-not-a-real-key";
const START = new Date("2026-10-14T10:00:00.000Z");

const docPayload = (label: string, modified = "2026-10-01 12:00:00") => ({
  html_de: `<h1>${label}</h1><p onclick="x()">${label} DE</p><script>alert(1)</script>`,
  html_en: `<h1>${label}</h1><p>${label} EN</p>`,
  created: "2026-01-15 12:00:00",
  modified,
  pushed: "2026-10-01T10:00:00.000000Z",
  warnings: "<p>Bitte Adresse erg&auml;nzen.</p>",
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Call {
  headers: Record<string, string>;
  path: string;
}

/** eRecht24 stand-in: answers from `respond` (per call) and records every call. */
function fakeErecht24() {
  const calls: Call[] = [];
  let respond: (path: string) => Response | Promise<Response> = () =>
    json(500, { message: "not set up" });
  const fetchLike = (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/v2", "");
    calls.push({
      path,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return Promise.resolve(respond(path));
  };
  return {
    calls,
    fetch: fetchLike as unknown as typeof fetch,
    set: (fn: typeof respond) => {
      respond = fn;
    },
  };
}

/** App with an injected eRecht24 fake and a movable clock; no database is needed for /legal. */
function legalApp(env: Record<string, string> = {}) {
  const fake = fakeErecht24();
  const clock = { now: START };
  const deps: BaseDeps = {
    // The legal service and route never touch the database.
    db: {} as BaseDeps["db"],
    config: testConfig({
      ERECHT24_API_KEY: API_KEY,
      ERECHT24_PLUGIN_KEY: PLUGIN_KEY,
      ERECHT24_API_URL: BASE_URL,
      ...env,
    }),
    fetch: fake.fetch,
    now: () => clock.now,
  };
  const app = createApp(deps);
  async function get(path: string) {
    const res = await app.request(path);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { fake, get, advance, service: legalService(deps) };
}

const MISSING_WITHOUT_KEYS = {
  type: "imprint",
  status: "missing",
  html: { de: null, en: null },
  sourceModifiedAt: null,
  fetchedAt: null,
  warnings: [],
};

describe("legal texts (eRecht24, in-memory cache)", () => {
  it("answers missing unless both keys are set and never calls eRecht24", async () => {
    const variants: Record<string, string>[] = [
      { ERECHT24_API_KEY: "" },
      { ERECHT24_PLUGIN_KEY: "" },
      { ERECHT24_API_KEY: "", ERECHT24_PLUGIN_KEY: "" },
    ];
    for (const env of variants) {
      const t = legalApp(env);
      expect(t.service.configured).toBe(false);
      const res = await t.get("/legal/imprint");
      expect(res.status).toBe(200);
      expect(res.json).toEqual(MISSING_WITHOUT_KEYS);
      expect(t.fake.calls).toHaveLength(0);
    }
  });

  it("rejects unknown types and the removed push endpoint with 404", async () => {
    const t = legalApp();
    for (const path of ["/legal/cookies", "/legal/erecht24/push"]) {
      const res = await t.get(path);
      expect(res.status).toBe(404);
      expect(res.json.error).toBe("not_found");
    }
    expect(t.fake.calls).toHaveLength(0);
  });

  it("sends both keys, sanitises the HTML and caches a success for 24 h", async () => {
    const t = legalApp();
    t.fake.set(() => json(200, docPayload("Datenschutz")));

    const first = await t.get("/legal/privacy-policy");
    expect(first.status).toBe(200);
    expect(first.json).toEqual({
      type: "privacy-policy",
      status: "ready",
      html: { de: "<p>Datenschutz DE</p>", en: "<p>Datenschutz EN</p>" },
      sourceModifiedAt: "2026-10-01T10:00:00.000Z",
      fetchedAt: START.toISOString(),
      warnings: ["Bitte Adresse ergänzen."],
    });
    expect(t.fake.calls).toHaveLength(1);
    expect(t.fake.calls[0]?.path).toBe("/privacyPolicy");
    expect(t.fake.calls[0]?.headers).toMatchObject({
      "erecht24-api-key": API_KEY,
      "erecht24-plugin-key": PLUGIN_KEY,
    });

    // Inside the 24 h: served from memory.
    t.advance(LEGAL_CACHE_TTL_MS - 1000);
    expect((await t.get("/legal/privacy-policy")).json).toEqual(first.json);
    expect(t.fake.calls).toHaveLength(1);

    // After 24 h: pulled again.
    t.fake.set(() => json(200, docPayload("Neu", "2026-10-14 09:00:00")));
    t.advance(2000);
    const later = await t.get("/legal/privacy-policy");
    expect(later.json.html.de).toBe("<p>Neu DE</p>");
    expect(later.json.sourceModifiedAt).toBe("2026-10-14T07:00:00.000Z");
    expect(later.json.fetchedAt).toBe(
      new Date(START.getTime() + LEGAL_CACHE_TTL_MS + 1000).toISOString()
    );
    expect(t.fake.calls).toHaveLength(2);
  });

  it("caches each type separately", async () => {
    const t = legalApp();
    t.fake.set((path) => json(200, docPayload(path.slice(1))));
    await t.get("/legal/imprint");
    await t.get("/legal/privacy-policy");
    await t.get("/legal/privacy-policy-social-media");
    await t.get("/legal/imprint");
    expect(t.fake.calls.map((c) => c.path)).toEqual([
      "/imprint",
      "/privacyPolicy",
      "/privacyPolicySocialMedia",
    ]);
  });

  it("shares one running pull between parallel requests", async () => {
    const t = legalApp();
    let release: (res: Response) => void = () => undefined;
    t.fake.set(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    const pending = Promise.all([
      t.get("/legal/imprint"),
      t.get("/legal/imprint"),
      t.get("/legal/imprint"),
    ]);
    // Let the three requests reach the service before eRecht24 answers.
    await Bun.sleep(10);
    expect(t.fake.calls).toHaveLength(1);
    release(json(200, docPayload("Impressum")));
    const results = await pending;
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.json.html.de).toBe("<p>Impressum DE</p>");
    }
    expect(t.fake.calls).toHaveLength(1);
  });

  it("caches a failure for 60 s only", async () => {
    const t = legalApp();
    t.fake.set(() =>
      json(401, {
        message: "Invalid API key and/or Plugin key for the eRecht24 API.",
        debug: { token: API_KEY },
      })
    );
    const failed = await t.get("/legal/imprint");
    expect(failed.status).toBe(502);
    expect(failed.json.error).toBe("erecht24_unauthorized");
    expect(JSON.stringify(failed.json)).not.toContain(API_KEY);

    // Within 60 s the failure is served from memory, no second upstream call.
    t.advance(30_000);
    expect((await t.get("/legal/imprint")).status).toBe(502);
    expect(t.fake.calls).toHaveLength(1);

    t.fake.set(() => json(200, docPayload("Impressum")));
    t.advance(LEGAL_FAILURE_TTL_MS);
    const recovered = await t.get("/legal/imprint");
    expect(recovered.status).toBe(200);
    expect(recovered.json.status).toBe("ready");
    expect(t.fake.calls).toHaveLength(2);

    // The success is kept for 24 h again.
    t.advance(LEGAL_FAILURE_TTL_MS * 2);
    await t.get("/legal/imprint");
    expect(t.fake.calls).toHaveLength(2);
  });

  it("maps unreachable eRecht24 and invalid answers to 502", async () => {
    const t = legalApp();
    t.fake.set(() => {
      throw new TypeError("fetch failed");
    });
    const unreachable = await t.get("/legal/imprint");
    expect(unreachable.status).toBe(502);
    expect(unreachable.json.error).toBe("erecht24_unavailable");

    t.fake.set(() => new Response("<html>maintenance</html>"));
    t.advance(LEGAL_FAILURE_TTL_MS + 1);
    const invalid = await t.get("/legal/imprint");
    expect(invalid.status).toBe(502);
    expect(invalid.json.error).toBe("erecht24_bad_response");
  });

  it("keeps serving the last text while a refresh fails, retrying after 60 s", async () => {
    const t = legalApp();
    t.fake.set(() => json(200, docPayload("Impressum")));
    const first = await t.get("/legal/imprint");
    expect(first.json.status).toBe("ready");

    t.fake.set(() => json(503, { message: "down" }));
    t.advance(LEGAL_CACHE_TTL_MS + 1);
    const stale = await t.get("/legal/imprint");
    expect(stale.status).toBe(200);
    expect(stale.json).toEqual(first.json);
    expect(t.fake.calls).toHaveLength(2);

    // The failed refresh is remembered for 60 s, then eRecht24 is asked again.
    t.advance(LEGAL_FAILURE_TTL_MS - 1);
    await t.get("/legal/imprint");
    expect(t.fake.calls).toHaveLength(2);
    t.fake.set(() => json(200, docPayload("Neu", "2026-10-15 08:00:00")));
    t.advance(2);
    const fresh = await t.get("/legal/imprint");
    expect(fresh.json.html.de).toBe("<p>Neu DE</p>");
    expect(t.fake.calls).toHaveLength(3);
  });

  it("reports a text eRecht24 does not have yet as missing and asks again after 60 s", async () => {
    const t = legalApp();
    t.fake.set(() => json(404, { message: "Imprint not found." }));
    const res = await t.get("/legal/imprint");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      ...MISSING_WITHOUT_KEYS,
      fetchedAt: START.toISOString(),
    });

    t.advance(LEGAL_FAILURE_TTL_MS - 1);
    await t.get("/legal/imprint");
    expect(t.fake.calls).toHaveLength(1);

    t.fake.set(() => json(200, docPayload("Impressum")));
    t.advance(2);
    expect((await t.get("/legal/imprint")).json.status).toBe("ready");
    expect(t.fake.calls).toHaveLength(2);
  });

  it("treats HTML that is empty after sanitising as missing, keeps a single language", async () => {
    const t = legalApp();
    t.fake.set((path) =>
      path === "/imprint"
        ? json(200, {
            html_de: "<h1>Impressum</h1><script>x</script>",
            html_en: "",
          })
        : json(200, { html_de: "", html_en: "<p>Privacy only in English</p>" })
    );
    const empty = await t.get("/legal/imprint");
    expect(empty.json.status).toBe("missing");
    expect(empty.json.html).toEqual({ de: null, en: null });

    const english = await t.get("/legal/privacy-policy");
    expect(english.json.status).toBe("ready");
    expect(english.json.html).toEqual({
      de: null,
      en: "<p>Privacy only in English</p>",
    });
    expect(english.json.sourceModifiedAt).toBeNull();
  });
});

describe("removed legal admin functions", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("no longer serves /admin/legal/*", async () => {
    const admin = await ctx.createAdmin("admin");
    const status = await ctx.req("GET", "/admin/legal/status", {
      token: admin.token,
    });
    expect(status.status).toBe(404);
    for (const path of ["/admin/legal/refresh", "/admin/legal/push-client"]) {
      const res = await ctx.req("POST", path, { token: admin.token });
      expect(res.status).toBe(404);
    }
  });
});
