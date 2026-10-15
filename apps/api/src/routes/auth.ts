import { timingSafeEqual } from "node:crypto";
import {
  DevAuthRequest,
  DeviceAuthRequest,
  GooglePlayAuthRequest,
  type IdentityProvider,
  SteamAuthRequest,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { clientIp } from "../lib/client-ip.ts";
import { ApiError } from "../lib/errors.ts";
import { fixedWindowCounter, rateLimit } from "../lib/rate-limit.ts";
import { parseBody } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import { isGooglePlayConfigured } from "../services/google-play.ts";
import { identityExists } from "../services/identities.ts";
import { issuePlayerJwt, signInPlayer } from "../services/sessions.ts";
import { isSteamConfigured } from "../services/steam.ts";
import type { AppEnv, Deps } from "../types.ts";

const notConfigured = (provider: IdentityProvider) =>
  new ApiError(
    501,
    "provider_not_configured",
    `Login via ${provider} is not configured on this server`
  );

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** TESTWERT: how long clients and the relay may cache GET /auth/jwks. */
const JWKS_MAX_AGE_SECONDS = 300;

const HOUR_MS = 3_600_000;

/**
 * Player logins and tokens (P-027). The logins are thin routes over the Better Auth plugin
 * `soulwickPlayerAuth` (`auth.api.signInPlayer`): paths, bodies, answers (`AuthResponse`) and
 * error codes stay as before; `token` is now a Better Auth session token for
 * `Authorization: Bearer`.
 */
export function authRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  /**
   * Test phase login: player name + random device id. Only active with DEV_AUTH_ENABLED=true and
   * a matching `x-dev-auth-key` header. The device id is the `device` identity of the player
   * (P-014); the name is only used when the account is created.
   */
  app.post("/dev", async (c) => {
    const { DEV_AUTH_ENABLED, DEV_AUTH_KEY } = deps.config;
    if (!DEV_AUTH_ENABLED) {
      throw new ApiError(403, "dev_auth_disabled", "Dev login is disabled");
    }
    const key = c.req.header("x-dev-auth-key") ?? "";
    if (!(DEV_AUTH_KEY && safeEqual(key, DEV_AUTH_KEY))) {
      throw new ApiError(
        401,
        "invalid_dev_auth_key",
        "Missing or wrong x-dev-auth-key"
      );
    }
    const body = await parseBody(c, DevAuthRequest);
    return c.json(
      await signInPlayer(deps, {
        provider: "device",
        deviceId: body.deviceId,
        name: body.name,
      })
    );
  });

  /** New guest accounts per IP and hour (P-028); logins of known devices are not counted. */
  const newGuestAccounts = fixedWindowCounter({
    limit: deps.config.GUEST_ACCOUNTS_PER_HOUR,
    windowMs: HOUR_MS,
  });

  /**
   * Guest login per device (P-028): same `device` identity as `/dev`, but without a key, so
   * players without Steam or Google Play can play online. Stricter limits than the global one:
   * GUEST_LOGINS_PER_MINUTE logins and GUEST_ACCOUNTS_PER_HOUR new accounts per IP.
   */
  app.post(
    "/device",
    rateLimit({
      limit: deps.config.GUEST_LOGINS_PER_MINUTE,
      trustProxy: deps.config.TRUST_PROXY,
      name: "auth-device",
    }),
    async (c) => {
      if (!deps.config.GUEST_AUTH_ENABLED) {
        throw new ApiError(
          403,
          "guest_auth_disabled",
          "Guest login is disabled"
        );
      }
      const body = await parseBody(c, DeviceAuthRequest);
      const ip = clientIp(c, deps.config.TRUST_PROXY);
      const isNew = !(await identityExists(deps.db, "device", body.deviceId));
      if (isNew) {
        const retryAfter = newGuestAccounts.blockedFor(ip);
        if (retryAfter !== null) {
          c.header("Retry-After", String(retryAfter));
          throw new ApiError(
            429,
            "rate_limited",
            "Too many new guest accounts from this network"
          );
        }
      }
      const answer = await signInPlayer(deps, {
        provider: "device",
        deviceId: body.deviceId,
        name: body.name,
      });
      if (isNew) {
        newGuestAccounts.hit(ip);
      }
      return c.json(answer);
    }
  );

  /**
   * Steam login (KONZEPT_ONLINE.md §3.2). The game sends the hex ticket of
   * `GetAuthTicketForWebApi(STEAM_TICKET_IDENTITY)`; the server verifies it at Steam with the
   * publisher key. 501 `provider_not_configured` until STEAM_WEB_API_KEY and STEAM_APP_ID are set.
   */
  app.post("/steam", async (c) => {
    if (!isSteamConfigured(deps)) {
      throw notConfigured("steam");
    }
    const body = await parseBody(c, SteamAuthRequest);
    return c.json(
      await signInPlayer(deps, {
        provider: "steam",
        ticket: body.ticket,
        name: body.name,
      })
    );
  });

  /**
   * Google Play Games login (KONZEPT_ONLINE.md §3.3): the server auth code is exchanged at Google,
   * the player id comes from Google, never from the device. 501 `provider_not_configured` until
   * GOOGLE_PLAY_CLIENT_ID and GOOGLE_PLAY_CLIENT_SECRET are set.
   */
  app.post("/google-play", async (c) => {
    if (!isGooglePlayConfigured(deps)) {
      throw notConfigured("google_play");
    }
    const body = await parseBody(c, GooglePlayAuthRequest);
    return c.json(
      await signInPlayer(deps, {
        provider: "google_play",
        serverAuthCode: body.serverAuthCode,
        name: body.name,
      })
    );
  });

  /**
   * Game Center login, planned with iOS (contract GameCenterAuthRequest, KONZEPT_ONLINE.md §3.4).
   * Until then 501 `not_implemented`.
   */
  app.post("/game-center", () => {
    throw new ApiError(
      501,
      "not_implemented",
      "Game Center login is not available yet"
    );
  });

  /**
   * Short-lived player JWT for `hello.token` at the relay (contract `AuthTokenResponse`). Players
   * only: admin sessions 401 `unauthorized`, banned players 403 `banned`.
   */
  app.get("/token", requirePlayer(deps), async (c) => {
    c.header("cache-control", "no-store");
    return c.json(await issuePlayerJwt(deps, c.get("player")));
  });

  /** Public keys of the player JWTs (JWKS); the relay fetches and caches them. */
  app.get("/jwks", async (c) => {
    const jwks = await deps.auth.api.getJwks();
    c.header("cache-control", `public, max-age=${JWKS_MAX_AGE_SECONDS}`);
    return c.json(jwks);
  });

  return app;
}
