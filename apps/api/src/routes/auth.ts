import { timingSafeEqual } from "node:crypto";
import {
  AppleNativeAuthRequest,
  type AppleNonceResponse,
  DevAuthRequest,
  DeviceAuthRequest,
  GameCenterAuthRequest,
  GooglePlayAuthRequest,
  type IdentityProvider,
  PasswordLoginRequest,
  SteamAuthRequest,
} from "@soulwick/contracts";
import { Hono } from "hono";
import { clientIp, proxyTrust } from "../lib/client-ip.ts";
import { ApiError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { fixedWindowCounter, rateLimit } from "../lib/rate-limit.ts";
import { iso, parseBody } from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import {
  isAppleNativeConfigured,
  issueAppleNonce,
  verifyAppleNative,
} from "../services/apple.ts";
import { isGameCenterConfigured } from "../services/game-center.ts";
import { isGooglePlayConfigured } from "../services/google-play.ts";
import { identityExists } from "../services/identities.ts";
import { verifyPasswordLogin } from "../services/logins.ts";
import {
  issuePlayerJwt,
  signInPlayer,
  signInWithLogin,
} from "../services/sessions.ts";
import { isSteamConfigured } from "../services/steam.ts";
import type { AppEnv, Deps } from "../types.ts";
import { webLoginRoutes } from "./web-login.ts";

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
/** TESTWERT: window of PASSWORD_FAILURES_PER_USERNAME. */
const PASSWORD_FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * Player logins and tokens (P-027). The logins are thin routes over the Better Auth plugin
 * `soulwickPlayerAuth` (`auth.api.signInPlayer`): paths, bodies, answers (`AuthResponse`) and
 * error codes stay as before; `token` is now a Better Auth session token for
 * `Authorization: Bearer`.
 */
export function authRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const logger = createLogger(deps.config.LOG_LEVEL);
  const now = () => deps.now?.() ?? new Date();

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
        appearance: body.appearance,
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
      trustProxy: proxyTrust(deps.config),
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
      const ip = clientIp(c, proxyTrust(deps.config));
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
        appearance: body.appearance,
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
        appearance: body.appearance,
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
        appearance: body.appearance,
      })
    );
  });

  const loginLimit = (name: string) =>
    rateLimit({
      limit: deps.config.LOGIN_ATTEMPTS_PER_MINUTE,
      trustProxy: proxyTrust(deps.config),
      name,
    });

  /**
   * Game Center login of the iOS app (contract GameCenterAuthRequest, KONZEPT_ONLINE.md §3.4):
   * signature checked with Apple's certificate. 501 until GAME_CENTER_BUNDLE_IDS is set.
   */
  app.post("/game-center", loginLimit("auth-game-center"), async (c) => {
    if (!isGameCenterConfigured(deps.config)) {
      throw notConfigured("game_center");
    }
    const body = await parseBody(c, GameCenterAuthRequest);
    const login = await deps.gameCenter.verify(body, now());
    return c.json(
      await signInWithLogin(deps, {
        ...login,
        name: body.name,
        appearance: body.appearance,
      })
    );
  });

  /** Failed password logins per username (P-036 (5)); the IP limit comes on top. */
  const passwordFailures = fixedWindowCounter({
    limit: deps.config.PASSWORD_FAILURES_PER_USERNAME,
    windowMs: PASSWORD_FAILURE_WINDOW_MS,
  });

  /**
   * Username + password (KF5). Unknown username and wrong password answer the same 401
   * `invalid_credentials`; after PASSWORD_FAILURES_PER_USERNAME failures the username is locked
   * for the rest of the window (429, same for existing and unknown names).
   */
  app.post("/password", loginLimit("auth-password"), async (c) => {
    const body = await parseBody(c, PasswordLoginRequest);
    const key = body.username.toLowerCase();
    const retryAfter = passwordFailures.blockedFor(key);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new ApiError(429, "rate_limited", "Too many failed logins");
    }
    const login = await verifyPasswordLogin(
      deps.db,
      body.username,
      body.password
    );
    if (!login) {
      passwordFailures.hit(key);
      throw new ApiError(
        401,
        "invalid_credentials",
        "Username or password wrong"
      );
    }
    return c.json(await signInWithLogin(deps, login));
  });

  /** One-time nonce for Sign in with Apple in the iOS app (required by POST /auth/apple). */
  app.post("/apple/nonce", loginLimit("auth-apple-nonce"), async (c) => {
    if (!isAppleNativeConfigured(deps.config)) {
      throw notConfigured("apple");
    }
    const { nonce, expiresAt } = await issueAppleNonce(
      deps.db,
      deps.config,
      now()
    );
    const body: AppleNonceResponse = { nonce, expiresAt: iso(expiresAt) };
    c.header("cache-control", "no-store");
    return c.json(body, 201);
  });

  /**
   * Sign in with Apple in the iOS app (D-188 (2)): identity token checked against Apple's keys,
   * the authorization code gives the refresh token that is revoked when the account is deleted.
   */
  app.post("/apple", loginLimit("auth-apple"), async (c) => {
    const body = await parseBody(c, AppleNativeAuthRequest);
    const { sub, account } = await verifyAppleNative(
      deps,
      deps.appleKeys,
      { ...body, now: now() },
      logger
    );
    return c.json(
      await signInWithLogin(deps, {
        provider: "apple",
        providerUserId: sub,
        account: { providerId: "apple", accountId: sub, ...account },
        name: body.name,
        appearance: body.appearance,
      })
    );
  });

  // Web login from the game, browser flows and magic links (KF5): routes/web-login.ts.
  app.route("/", webLoginRoutes(deps));

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
