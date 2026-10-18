import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  API_VERSION,
  HealthResponse,
  PROTOCOL_VERSION,
  PublicConfig,
} from "@soulwick/contracts";
import { createTestContext, type TestContext, testConfig } from "./helpers.ts";

describe("versions and environments (P16)", () => {
  describe("defaults", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext();
    });
    afterAll(() => ctx.close());

    it("/health reports minGameVersion null and the default protocol version", async () => {
      const res = await ctx.req("GET", "/health");
      expect(res.status).toBe(200);
      expect(HealthResponse.parse(res.json)).toMatchObject({
        status: "ok",
        apiVersion: API_VERSION,
        minGameVersion: null,
        protocolVersion: PROTOCOL_VERSION,
      });
    });

    it("/public/config reports no relay without RELAY_PUBLIC_URL", async () => {
      const res = await ctx.req("GET", "/public/config");
      expect(res.status).toBe(200);
      expect(PublicConfig.parse(res.json)).toEqual({
        apiVersion: API_VERSION,
        minGameVersion: null,
        protocolVersion: PROTOCOL_VERSION,
        relayUrl: null,
        supportEmail: null,
        guestAuth: true,
      });
    });
  });

  describe("configured environment", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({
        MIN_GAME_VERSION: "1.2.0",
        PROTOCOL_VERSION: "3",
        RELAY_PUBLIC_URL: "wss://play.dev.example.test",
        SUPPORT_EMAIL: "support@example.test",
      });
    });
    afterAll(() => ctx.close());

    it("/health and /public/config report the environment's values", async () => {
      const health = await ctx.req("GET", "/health");
      expect(health.json).toMatchObject({
        minGameVersion: "1.2.0",
        protocolVersion: 3,
      });
      const config = await ctx.req("GET", "/public/config");
      expect(config.json).toEqual({
        apiVersion: API_VERSION,
        minGameVersion: "1.2.0",
        protocolVersion: 3,
        relayUrl: "wss://play.dev.example.test/v1",
        supportEmail: "support@example.test",
        guestAuth: true,
      });
    });
  });

  it("keeps an explicit relay path and rejects invalid values", () => {
    expect(
      testConfig({ RELAY_PUBLIC_URL: "ws://localhost:3103/v1/" })
        .RELAY_PUBLIC_URL
    ).toBe("ws://localhost:3103/v1");
    expect(() =>
      testConfig({ RELAY_PUBLIC_URL: "https://play.example.test" })
    ).toThrow("RELAY_PUBLIC_URL");
    expect(() => testConfig({ MIN_GAME_VERSION: "latest" })).toThrow(
      "MIN_GAME_VERSION"
    );
    expect(
      testConfig({ MIN_GAME_VERSION: "1.0.0-beta.2" }).MIN_GAME_VERSION
    ).toBe("1.0.0-beta.2");
    expect(() => testConfig({ PROTOCOL_VERSION: "-1" })).toThrow(
      "PROTOCOL_VERSION"
    );
    expect(() => testConfig({ SUPPORT_EMAIL: "no-address" })).toThrow(
      "SUPPORT_EMAIL"
    );
    expect(testConfig({ SUPPORT_EMAIL: "" }).SUPPORT_EMAIL).toBe("");
  });

  it("older clients still parse the health answer without the new fields", () => {
    expect(
      HealthResponse.safeParse({
        status: "ok",
        apiVersion: "1.0.0",
        db: "ok",
        time: new Date().toISOString(),
      }).success
    ).toBe(true);
  });
});
