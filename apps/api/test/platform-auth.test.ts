import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  GOOGLE_TOKEN_URL,
  PLAY_GAMES_PLAYER_URL,
} from "../src/services/google-play.ts";
import { STEAM_AUTH_URL } from "../src/services/steam.ts";
import { createTestContext, type TestContext } from "./helpers.ts";

/** Obviously fake ids: below the SteamID64 range of real individual accounts. */
const STEAM_ID = "76561190000000042";
const PLAY_ID = "g-test-player-0001";
const TICKET = "deadbeef".repeat(8);
const SERVER_AUTH_CODE = "4/test-server-auth-code";

interface Call {
  body: string | null;
  headers: Record<string, string>;
  method: string;
  url: URL;
}

type Handler = (
  call: Call,
  signal: AbortSignal | undefined
) => Promise<Response> | Response;

/** Fake fetch for Steam and Google: tests swap `handler` and inspect `calls`. */
function fakeFetch() {
  const state: { calls: Call[]; handler: Handler } = {
    calls: [],
    handler: () => new Response("unexpected call", { status: 599 }),
  };
  const fetchLike = async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? String(init.body) : null,
    };
    state.calls.push(call);
    return await state.handler(call, init?.signal ?? undefined);
  };
  return { state, fetch: fetchLike as unknown as typeof fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Never answers; rejects when the API's timeout aborts the request. */
const hang: Handler = (_call, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

const steamOk =
  (params: Record<string, unknown> = {}): Handler =>
  () =>
    json({
      response: {
        params: {
          result: "OK",
          steamid: STEAM_ID,
          ownersteamid: STEAM_ID,
          vacbanned: false,
          publisherbanned: false,
          ...params,
        },
      },
    });

const googleOk =
  (playerId = PLAY_ID): Handler =>
  (call) => {
    if (call.url.href === GOOGLE_TOKEN_URL) {
      return json({ access_token: "ya29.test-access-token", expires_in: 3599 });
    }
    if (call.url.href === PLAY_GAMES_PLAYER_URL) {
      return json({ kind: "games#player", playerId, displayName: "Ignored" });
    }
    return new Response("unexpected", { status: 599 });
  };

describe("platform login (P14)", () => {
  const fake = fakeFetch();
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext(
      {
        STEAM_WEB_API_KEY: "test-steam-publisher-key",
        STEAM_APP_ID: "4000001",
        STEAM_TICKET_IDENTITY: "soulwick",
        GOOGLE_PLAY_CLIENT_ID: "test-client.apps.googleusercontent.com",
        GOOGLE_PLAY_CLIENT_SECRET: "test-client-secret",
        EXTERNAL_AUTH_TIMEOUT_MS: "150",
      },
      { fetch: fake.fetch }
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fake.state.calls = [];
  });

  describe("steam", () => {
    it("verifies the ticket at Steam and finds or creates the player via the steam identity", async () => {
      fake.state.handler = steamOk();
      const first = await ctx.req("POST", "/auth/steam", {
        body: { ticket: TICKET, name: "Dampfkerze" },
      });
      expect(first.status).toBe(200);
      expect(first.json.player).toMatchObject({
        name: "Dampfkerze",
        steamId: STEAM_ID,
      });

      const [call] = fake.state.calls;
      expect(`${call?.url.origin}${call?.url.pathname}`).toBe(STEAM_AUTH_URL);
      expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
        key: "test-steam-publisher-key",
        appid: "4000001",
        ticket: TICKET,
        identity: "soulwick",
      });

      const second = await ctx.req("POST", "/auth/steam", {
        body: { ticket: TICKET, name: "Anderer Name" },
      });
      expect(second.status).toBe(200);
      expect(second.json.player.id).toBe(first.json.player.id);
      expect(second.json.player.name).toBe("Dampfkerze");
      const identities = await ctx.db.playerIdentity.findMany({
        where: { playerId: first.json.player.id },
      });
      expect(identities).toEqual([
        expect.objectContaining({
          provider: "steam",
          providerUserId: STEAM_ID,
        }),
      ]);
    });

    it("uses a fallback name when the game sends none", async () => {
      fake.state.handler = steamOk({ steamid: "76561190000000077" });
      const res = await ctx.req("POST", "/auth/steam", {
        body: { ticket: TICKET },
      });
      expect(res.status).toBe(200);
      expect(res.json.player.name).toBe("Spieler-0077");
    });

    it("rejects an invalid ticket without Steam details", async () => {
      fake.state.handler = () =>
        json({
          response: {
            error: {
              errorcode: 101,
              errordesc: "Invalid ticket (internal detail)",
            },
          },
        });
      const res = await ctx.req("POST", "/auth/steam", {
        body: { ticket: TICKET },
      });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe("invalid_steam_ticket");
      expect(JSON.stringify(res.json)).not.toContain("internal detail");
    });

    it("rejects publisher- and VAC-banned Steam accounts without creating a player", async () => {
      const before = await ctx.db.player.count();
      for (const flag of ["publisherbanned", "vacbanned"]) {
        fake.state.handler = steamOk({
          steamid: "76561190000000099",
          [flag]: true,
        });
        const res = await ctx.req("POST", "/auth/steam", {
          body: { ticket: TICKET },
        });
        expect(res.status).toBe(403);
        expect(res.json.error).toBe("steam_banned");
      }
      expect(await ctx.db.player.count()).toBe(before);
    });

    it("answers 502 steam_unavailable on timeout, HTTP errors and garbage", async () => {
      for (const handler of [
        hang,
        () => new Response("oops", { status: 500 }),
        () => new Response("<html>", { status: 200 }),
        () => json({}),
      ] satisfies Handler[]) {
        fake.state.handler = handler;
        const res = await ctx.req("POST", "/auth/steam", {
          body: { ticket: TICKET },
        });
        expect(res.status).toBe(502);
        expect(res.json.error).toBe("steam_unavailable");
      }
    });

    it("a player banned on Soulwick gets 403 banned", async () => {
      fake.state.handler = steamOk({ steamid: "76561190000000123" });
      const login = await ctx.req("POST", "/auth/steam", {
        body: { ticket: TICKET },
      });
      await ctx.db.ban.create({
        data: { playerId: login.json.player.id, reason: "Testsperre" },
      });
      const again = await ctx.req("POST", "/auth/steam", {
        body: { ticket: TICKET },
      });
      expect(again.status).toBe(403);
      expect(again.json).toMatchObject({
        error: "banned",
        reason: "Testsperre",
      });
    });

    it("validates the ticket format before calling Steam", async () => {
      const res = await ctx.req("POST", "/auth/steam", {
        body: { ticket: "not-hex" },
      });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("validation_error");
      expect(fake.state.calls).toHaveLength(0);
    });
  });

  describe("google play", () => {
    it("exchanges the server auth code, reads the player id from Google and reuses the identity", async () => {
      fake.state.handler = googleOk();
      const first = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE, name: "Handylicht" },
      });
      expect(first.status).toBe(200);
      expect(first.json.player).toMatchObject({
        name: "Handylicht",
        steamId: null,
      });

      const [tokenCall, playerCall] = fake.state.calls;
      expect(tokenCall?.url.href).toBe(GOOGLE_TOKEN_URL);
      expect(tokenCall?.method).toBe("POST");
      expect(
        Object.fromEntries(new URLSearchParams(tokenCall?.body ?? ""))
      ).toEqual({
        code: SERVER_AUTH_CODE,
        client_id: "test-client.apps.googleusercontent.com",
        client_secret: "test-client-secret",
        grant_type: "authorization_code",
        redirect_uri: "",
      });
      expect(playerCall?.url.href).toBe(PLAY_GAMES_PLAYER_URL);
      expect(playerCall?.headers.authorization).toBe(
        "Bearer ya29.test-access-token"
      );

      const second = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE },
      });
      expect(second.json.player.id).toBe(first.json.player.id);
      const identities = await ctx.db.playerIdentity.findMany({
        where: { playerId: first.json.player.id },
      });
      expect(identities).toEqual([
        expect.objectContaining({
          provider: "google_play",
          providerUserId: PLAY_ID,
        }),
      ]);
    });

    it("rejects an invalid or used code with 401 invalid_google_play_code", async () => {
      fake.state.handler = () =>
        json({ error: "invalid_grant", error_description: "Bad Request" }, 400);
      const res = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE },
      });
      expect(res.status).toBe(401);
      expect(res.json.error).toBe("invalid_google_play_code");
      expect(fake.state.calls).toHaveLength(1);

      fake.state.handler = (call) =>
        call.url.href === GOOGLE_TOKEN_URL
          ? json({ access_token: "ya29.revoked" })
          : json({ error: { code: 401 } }, 401);
      const revoked = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE },
      });
      expect(revoked.status).toBe(401);
      expect(revoked.json.error).toBe("invalid_google_play_code");
    });

    it("answers 502 google_play_unavailable when Google cannot be reached", async () => {
      for (const handler of [
        hang,
        () => {
          throw new TypeError("fetch failed");
        },
        () => new Response("oops", { status: 503 }),
        (call: Call) =>
          call.url.href === GOOGLE_TOKEN_URL
            ? json({ access_token: "ya29.ok" })
            : new Response("oops", { status: 500 }),
        (call: Call) =>
          call.url.href === GOOGLE_TOKEN_URL
            ? json({ access_token: "ya29.ok" })
            : json({ kind: "games#player" }),
      ] satisfies Handler[]) {
        fake.state.handler = handler;
        const res = await ctx.req("POST", "/auth/google-play", {
          body: { serverAuthCode: SERVER_AUTH_CODE },
        });
        expect(res.status).toBe(502);
        expect(res.json.error).toBe("google_play_unavailable");
      }
    });

    it("a player banned on Soulwick gets 403 banned with reason and end", async () => {
      fake.state.handler = googleOk("g-test-player-banned");
      const login = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE },
      });
      const until = new Date(Date.now() + 86_400_000);
      await ctx.db.ban.create({
        data: {
          playerId: login.json.player.id,
          reason: "Testsperre",
          expiresAt: until,
        },
      });
      const again = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE },
      });
      expect(again.status).toBe(403);
      expect(again.json).toEqual({
        error: "banned",
        message: "Testsperre",
        reason: "Testsperre",
        expiresAt: until.toISOString(),
      });
    });

    it("never takes a player id from the request", async () => {
      fake.state.handler = googleOk("g-test-player-0002");
      const res = await ctx.req("POST", "/auth/google-play", {
        body: { serverAuthCode: SERVER_AUTH_CODE, playerId: "g-forged" },
      });
      expect(res.status).toBe(200);
      expect(
        await ctx.db.playerIdentity.count({
          where: { providerUserId: "g-forged" },
        })
      ).toBe(0);
    });

    it("validates the body", async () => {
      const res = await ctx.req("POST", "/auth/google-play", { body: {} });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("validation_error");
    });
  });

  it("game center is planned: 501 not_implemented", async () => {
    const res = await ctx.req("POST", "/auth/game-center", { body: {} });
    expect(res.status).toBe(501);
    expect(res.json.error).toBe("not_implemented");
  });
});

describe("platform login without provider configuration", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("steam and google play answer 501 provider_not_configured", async () => {
    const steam = await ctx.req("POST", "/auth/steam", {
      body: { ticket: TICKET },
    });
    expect(steam.status).toBe(501);
    expect(steam.json.error).toBe("provider_not_configured");
    const google = await ctx.req("POST", "/auth/google-play", {
      body: { serverAuthCode: SERVER_AUTH_CODE },
    });
    expect(google.status).toBe(501);
    expect(google.json.error).toBe("provider_not_configured");
  });
});
