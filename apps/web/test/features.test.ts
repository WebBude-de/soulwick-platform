import { afterEach, describe, expect, it, mock } from "bun:test";

// `server-only` throws outside the react-server condition; Next.js resolves it to an empty module.
mock.module("server-only", () => ({}));
const { liveFeaturesEnabled, parseLiveFeatures } = await import(
  "../src/lib/features.ts"
);

const ORIGINAL = process.env.LIVE_FEATURES;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.LIVE_FEATURES;
  } else {
    process.env.LIVE_FEATURES = ORIGINAL;
  }
});

describe("parseLiveFeatures", () => {
  it("is on when unset or empty (development default)", () => {
    expect(parseLiveFeatures(undefined)).toBe(true);
    expect(parseLiveFeatures("")).toBe(true);
    expect(parseLiveFeatures("   ")).toBe(true);
  });

  it("is on for true, 1, on, yes in any case", () => {
    for (const value of ["true", "TRUE", " True ", "1", "on", "yes"]) {
      expect(parseLiveFeatures(value)).toBe(true);
    }
  });

  it("is off for false and for anything unknown", () => {
    for (const value of [
      "false",
      "FALSE",
      " false ",
      "0",
      "off",
      "no",
      "flase",
    ]) {
      expect(parseLiveFeatures(value)).toBe(false);
    }
  });
});

describe("liveFeaturesEnabled", () => {
  it("reads LIVE_FEATURES on every call, not once at import", () => {
    delete process.env.LIVE_FEATURES;
    expect(liveFeaturesEnabled()).toBe(true);
    process.env.LIVE_FEATURES = "false";
    expect(liveFeaturesEnabled()).toBe(false);
    process.env.LIVE_FEATURES = "true";
    expect(liveFeaturesEnabled()).toBe(true);
  });
});
