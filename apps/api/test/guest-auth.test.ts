import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  AuthResponse,
  AuthTokenResponse,
  PublicConfig,
} from "@soulwick/contracts";
import { createTestContext, DEV_KEY, type TestContext } from "./helpers.ts";

/** POST /auth/device: guest login per device (P-028). */
describe("guest login POST /auth/device", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  const guest = (
    t: TestContext,
    body: unknown,
    headers: Record<string, string> = {}
  ) => t.req("POST", "/auth/device", { body, headers });

  it("creates an account and reuses it for the same device", async () => {
    const deviceId = randomUUID();
    const first = await guest(ctx, { name: "Gast", deviceId });
    expect(first.status).toBe(200);
    const auth = AuthResponse.parse(first.json);
    expect(auth.player).toMatchObject({
      name: "Gast",
      guild: null,
      steamId: null,
    });

    const second = await guest(ctx, { name: "Anderer Name", deviceId });
    expect(second.status).toBe(200);
    expect(second.json.player.id).toBe(auth.player.id);
    expect(second.json.player.name).toBe("Gast");

    const me = await ctx.req("GET", "/me", { token: second.json.token });
    expect(me.status).toBe(200);
    expect(me.json.id).toBe(auth.player.id);

    const ids = await ctx.req("GET", "/me/identities", { token: auth.token });
    expect(ids.json.items).toHaveLength(1);
    expect(ids.json.items[0].provider).toBe("device");
  });

  it("shares the device identity with the dev login", async () => {
    const deviceId = randomUUID();
    const dev = await ctx.req("POST", "/auth/dev", {
      headers: { "x-dev-auth-key": DEV_KEY },
      body: { name: "Tester", deviceId },
    });
    expect(dev.status).toBe(200);
    const asGuest = await guest(ctx, { name: "Gast", deviceId });
    expect(asGuest.status).toBe(200);
    expect(asGuest.json.player.id).toBe(dev.json.player.id);
    expect(asGuest.json.player.name).toBe("Tester");
  });

  it("rejects short or malformed device ids and bad names with 400", async () => {
    for (const deviceId of [
      "short",
      "a".repeat(31),
      "a".repeat(129),
      `${randomUUID()}_x`,
      `${randomUUID()} x`,
      "äöü".repeat(12),
    ]) {
      const res = await guest(ctx, { name: "Gast", deviceId });
      expect(res.status, deviceId).toBe(400);
      expect(res.json.error).toBe("validation_error");
    }
    const badName = await guest(ctx, { name: "G", deviceId: randomUUID() });
    expect(badName.status).toBe(400);
    expect(badName.json.error).toBe("validation_error");
    const noBody = await ctx.req("POST", "/auth/device");
    expect(noBody.status).toBe(400);
  });

  it("accepts a 128-character id of letters, digits and dashes", async () => {
    const deviceId = `${"Ab9-".repeat(32)}`;
    const res = await guest(ctx, { name: "Gast", deviceId });
    expect(res.status).toBe(200);
  });

  it("issues a relay token for the guest session", async () => {
    const login = await guest(ctx, { name: "Gast", deviceId: randomUUID() });
    const res = await ctx.req("GET", "/auth/token", {
      token: login.json.token,
    });
    expect(res.status).toBe(200);
    expect(AuthTokenResponse.parse(res.json).token.split(".")).toHaveLength(3);
  });

  it("refuses banned players like the other logins", async () => {
    const deviceId = randomUUID();
    const login = await guest(ctx, { name: "Gast", deviceId });
    const mod = await ctx.createAdmin("moderator");
    const ban = await ctx.req(
      "POST",
      `/admin/players/${login.json.player.id}/bans`,
      { token: mod.token, body: { reason: "Cheating", durationDays: 7 } }
    );
    expect(ban.status).toBe(201);

    const again = await guest(ctx, { name: "Gast", deviceId });
    expect(again.status).toBe(403);
    expect(again.json.error).toBe("banned");
    expect(again.json.reason).toBe("Cheating");
    expect(typeof again.json.expiresAt).toBe("string");
  });

  it("/public/config reports the guest login as open", async () => {
    const res = await ctx.req("GET", "/public/config");
    expect(PublicConfig.parse(res.json).guestAuth).toBe(true);
  });

  it("answers 403 guest_auth_disabled when GUEST_AUTH_ENABLED=false", async () => {
    const off = await createTestContext({ GUEST_AUTH_ENABLED: "false" });
    try {
      const res = await guest(off, { name: "Gast", deviceId: randomUUID() });
      expect(res.status).toBe(403);
      expect(res.json.error).toBe("guest_auth_disabled");
      const config = await off.req("GET", "/public/config");
      expect(config.json.guestAuth).toBe(false);
      // The dev login stays independent of the switch.
      const dev = await off.req("POST", "/auth/dev", {
        headers: { "x-dev-auth-key": DEV_KEY },
        body: { name: "Tester", deviceId: randomUUID() },
      });
      expect(dev.status).toBe(200);
    } finally {
      await off.close();
    }
  });

  describe("rate limits", () => {
    let limited: TestContext;
    beforeAll(async () => {
      limited = await createTestContext({
        GUEST_LOGINS_PER_MINUTE: "4",
        GUEST_ACCOUNTS_PER_HOUR: "2",
      });
    });
    afterAll(() => limited.close());

    it("limits logins per IP and minute", async () => {
      const ip = { "x-forwarded-for": "198.51.100.10" };
      const deviceId = randomUUID();
      for (let i = 0; i < 4; i += 1) {
        const res = await guest(limited, { name: "Gast", deviceId }, ip);
        expect(res.status).toBe(200);
      }
      const blocked = await guest(limited, { name: "Gast", deviceId }, ip);
      expect(blocked.status).toBe(429);
      expect(blocked.json.error).toBe("rate_limited");

      const otherIp = await guest(
        limited,
        { name: "Gast", deviceId },
        { "x-forwarded-for": "198.51.100.11" }
      );
      expect(otherIp.status).toBe(200);
    });

    it("limits new accounts per IP and hour, known devices still log in", async () => {
      const ip = { "x-forwarded-for": "198.51.100.20" };
      const known = randomUUID();
      expect(
        (await guest(limited, { name: "Gast", deviceId: known }, ip)).status
      ).toBe(200);
      expect(
        (await guest(limited, { name: "Gast", deviceId: randomUUID() }, ip))
          .status
      ).toBe(200);

      const third = await guest(
        limited,
        { name: "Gast", deviceId: randomUUID() },
        ip
      );
      expect(third.status).toBe(429);
      expect(third.json.error).toBe("rate_limited");

      const again = await guest(limited, { name: "Gast", deviceId: known }, ip);
      expect(again.status).toBe(200);

      const otherIp = await guest(
        limited,
        { name: "Gast", deviceId: randomUUID() },
        { "x-forwarded-for": "198.51.100.21" }
      );
      expect(otherIp.status).toBe(200);
    });
  });
});
