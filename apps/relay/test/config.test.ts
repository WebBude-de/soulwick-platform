import { describe, expect, it } from "bun:test";
import { loadConfig } from "../src/config.ts";

describe("relay config (P-027)", () => {
  it("derives the JWKS URL from API_INTERNAL_URL", () => {
    const config = loadConfig({
      API_INTERNAL_URL: "http://soulwick-api:8787/",
    });
    expect(config.API_INTERNAL_URL).toBe("http://soulwick-api:8787");
    expect(config.JWKS_URL).toBe("http://soulwick-api:8787/auth/jwks");
    expect(config.JWKS_CACHE_SECONDS).toBe(600);
  });

  it("takes an explicit JWKS_URL", () => {
    const config = loadConfig({
      API_INTERNAL_URL: "http://soulwick-api:8787",
      JWKS_URL: "https://api.example.test/auth/jwks",
    });
    expect(config.JWKS_URL).toBe("https://api.example.test/auth/jwks");
  });

  it("backpressure defaults: 4 MiB buffer, 5 s grace (online test 16.10.2026)", () => {
    const config = loadConfig({ API_INTERNAL_URL: "http://soulwick-api:8787" });
    expect(config.MAX_BUFFERED_BYTES).toBe(4_194_304);
    expect(config.SLOW_CONSUMER_GRACE_SECONDS).toBe(5);
    expect(
      loadConfig({
        API_INTERNAL_URL: "http://soulwick-api:8787",
        SLOW_CONSUMER_GRACE_SECONDS: "0.5",
      }).SLOW_CONSUMER_GRACE_SECONDS
    ).toBe(0.5);
    expect(() =>
      loadConfig({
        API_INTERNAL_URL: "http://soulwick-api:8787",
        SLOW_CONSUMER_GRACE_SECONDS: "-1",
      })
    ).toThrow("SLOW_CONSUMER_GRACE_SECONDS");
  });

  it("needs API_INTERNAL_URL and no longer reads TOKEN_SECRET", () => {
    expect(() => loadConfig({ TOKEN_SECRET: "x".repeat(32) })).toThrow(
      "API_INTERNAL_URL"
    );
  });
});
