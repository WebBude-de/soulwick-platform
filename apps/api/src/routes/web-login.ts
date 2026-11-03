import {
  levelForXp,
  type MagicLinkPreview,
  MagicLinkPreviewQuery,
  MagicLinkRequest,
  type MagicLinkSentResponse,
  MagicLinkVerifyRequest,
  OAuthCallbackQuery,
  OAuthStartQuery,
  WEB_LOGIN_PAGE_PATH,
  WEB_LOGIN_POLL_INTERVAL_SECONDS,
  WebLoginCode,
  WebLoginConfirmMergeRequest,
  type WebLoginInfo,
  WebLoginInfoQuery,
  WebLoginPollRequest,
  type WebLoginPollResponse,
  WebLoginProvider,
  WebLoginStartRequest,
  type WebLoginStartResponse,
} from "@soulwick/contracts";
import type { Player } from "@soulwick/db";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ApiError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { fixedWindowCounter, rateLimit } from "../lib/rate-limit.ts";
import { hmacSecret, randomToken } from "../lib/secrets.ts";
import {
  iso,
  isoOrNull,
  parseBody,
  parseOptionalBody,
  parseParam,
  parseQuery,
} from "../lib/validate.ts";
import { requirePlayer } from "../middleware/auth.ts";
import { magicLinkMail } from "../services/magic-link-mail.ts";
import {
  authorizationUrl,
  finishOAuth,
  isWebProviderConfigured,
  oauthCallbackUrl,
  usesPkce,
} from "../services/oauth.ts";
import { issuePlayerSession } from "../services/sessions.ts";
import { steamOpenIdUrl, verifySteamOpenId } from "../services/steam-openid.ts";
import {
  collectWebLogin,
  completeWebLogin,
  confirmWebLoginMerge,
  createMagicLink,
  createOAuthState,
  createWebLogin,
  findWebLogin,
  isOpen,
  peekMagicLink,
  takeMagicLink,
  takeOAuthState,
  type WebLoginOutcome,
  webLoginInfo,
} from "../services/web-login.ts";
import type { AppEnv, Deps } from "../types.ts";

/** Cookie that binds a browser flow to the browser that started it (login CSRF protection). */
const BINDING_COOKIE = "sw_oauth_binding";
const BINDING_COOKIE_PATH = "/auth/oauth";
const HOUR_MS = 3_600_000;

/**
 * Web login from the game and the browser flows (KF5, P-036 (3), P-039), mounted under /auth:
 * - `POST /web-login`, `POST /web-login/poll`, `GET /web-login/:code`,
 *   `POST /web-login/confirm-merge`;
 * - `GET /oauth/:provider/start|callback` for Google, Apple, Discord and Steam OpenID;
 * - `POST /magic-link`, `GET /magic-link/preview`, `POST /magic-link/verify`.
 * The website (KF11) renders `/login/<code>` and `/login/magic`; this API only redirects there.
 */
export function webLoginRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const { config } = deps;
  const logger = createLogger(config.LOG_LEVEL);
  const now = () => deps.now?.() ?? new Date();
  const secret = () => hmacSecret(config);
  const loginLimit = (name: string) =>
    rateLimit({
      limit: config.LOGIN_ATTEMPTS_PER_MINUTE,
      trustProxy: config.TRUST_PROXY,
      name,
    });
  const mailsPerAddress = fixedWindowCounter({
    limit: config.MAGIC_LINKS_PER_ADDRESS_PER_HOUR,
    windowMs: HOUR_MS,
  });

  const pageUrl = (code: string | null, query: Record<string, string> = {}) => {
    const url = new URL(
      `${config.WEB_URL}${WEB_LOGIN_PAGE_PATH}${code ? `/${code}` : ""}`
    );
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  };

  /** Steam OpenID returns here; Steam echoes it as `openid.return_to` (checked exactly). */
  const steamReturnTo = (state: string) => {
    const url = new URL(oauthCallbackUrl(config, "steam"));
    url.searchParams.set("state", state);
    return url.toString();
  };

  /** What the website page may offer: magic link and the configured browser flows. */
  const methods = (): WebLoginInfo["methods"] => [
    ...(deps.mailer.enabled ? (["email"] as const) : []),
    ...WebLoginProvider.options.filter((p) =>
      isWebProviderConfigured(config, p)
    ),
  ];

  const info = async (
    row: NonNullable<Awaited<ReturnType<typeof findWebLogin>>>,
    code: string,
    confirmSecret?: string
  ) =>
    await webLoginInfo(deps.db, row, {
      code,
      confirmSecret,
      methods: methods(),
      secret: secret(),
      now: now(),
    });

  // --- request and polling (the game) ------------------------------------------------------------

  /**
   * Starts a request. `intent: "link"` needs the player session; with an Authorization header the
   * session is checked for both intents (an invalid token is 401, a banned player 403).
   */
  app.post(
    "/web-login",
    loginLimit("web-login"),
    async (c, next) => {
      if (c.req.header("authorization")) {
        return await requirePlayer(deps)(c, next);
      }
      await next();
    },
    async (c) => {
      const body = await parseOptionalBody(c, WebLoginStartRequest);
      const player = c.get("player") as Player | undefined;
      if (body.intent === "link" && !player) {
        throw new ApiError(
          401,
          "unauthorized",
          "Adding a login needs the player session"
        );
      }
      const created = await createWebLogin(deps.db, {
        intent: body.intent,
        playerId: body.intent === "link" && player ? player.id : null,
        locale: body.locale ?? "en",
        secret: secret(),
        now: now(),
      });
      const response: WebLoginStartResponse = {
        code: created.code,
        pollSecret: created.pollSecret,
        url: pageUrl(created.code),
        expiresAt: iso(created.expiresAt),
        pollIntervalSeconds: WEB_LOGIN_POLL_INTERVAL_SECONDS,
      };
      c.header("cache-control", "no-store");
      return c.json(response, 201);
    }
  );

  /** The game asks every 2 s; a completed request gives its session out exactly once. */
  app.post("/web-login/poll", async (c) => {
    const body = await parseBody(c, WebLoginPollRequest);
    const result = await collectWebLogin(deps.db, {
      code: body.code,
      pollSecret: body.pollSecret,
      secret: secret(),
      now: now(),
    });
    c.header("cache-control", "no-store");
    let response: WebLoginPollResponse;
    if (result.status === "completed") {
      const auth = await issuePlayerSession(deps, result.player);
      response = {
        status: "completed",
        result: result.row.intent === "link" ? "linked" : "signed_in",
        provider: result.row.provider ?? "email",
        merged: result.row.merged,
        removedPlayerId: result.row.removedPlayerId,
        auth,
      };
      logger.info("web_login_collected", {
        intent: result.row.intent,
        provider: result.row.provider,
        merged: result.row.merged,
      });
    } else if (result.status === "failed") {
      response = {
        status: "failed",
        error: result.error,
        ...(result.error === "banned"
          ? {
              reason: result.reason ?? null,
              expiresAt: isoOrNull(result.banExpiresAt),
            }
          : {}),
      };
    } else {
      response = { status: result.status };
    }
    return c.json(response);
  });

  /** For the website page `/login/<code>` (and `?confirm=` while a merge waits). */
  app.get("/web-login/:code", async (c) => {
    const code = parseParam(c, "code", WebLoginCode);
    const { confirm } = parseQuery(c, WebLoginInfoQuery);
    const row = await findWebLogin(deps.db, code, secret());
    if (!row) {
      throw new ApiError(404, "web_login_not_found", "Unknown login request");
    }
    c.header("cache-control", "no-store");
    return c.json(await info(row, code, confirm));
  });

  /** The browser that proved the login confirms the merge of two accounts with progress. */
  app.post(
    "/web-login/confirm-merge",
    loginLimit("web-login-confirm"),
    async (c) => {
      const body = await parseBody(c, WebLoginConfirmMergeRequest);
      const row = await confirmWebLoginMerge(deps.db, {
        code: body.code,
        confirmSecret: body.confirmSecret,
        secret: secret(),
        now: now(),
      });
      logger.info("web_login_merge_confirmed", {
        status: row.status,
        error: row.error ?? undefined,
      });
      return c.json(await info(row, body.code));
    }
  );

  // --- browser flows: Google, Apple, Discord, Steam OpenID ---------------------------------------

  app.get("/oauth/:provider/start", loginLimit("oauth-start"), async (c) => {
    const provider = parseParam(c, "provider", WebLoginProvider);
    const { code } = parseQuery(c, OAuthStartQuery);
    if (!isWebProviderConfigured(config, provider)) {
      return c.redirect(pageUrl(code, { error: "provider_not_configured" }));
    }
    const row = await findWebLogin(deps.db, code, secret());
    if (!row) {
      return c.redirect(pageUrl(null, { error: "web_login_not_found" }));
    }
    if (!isOpen(row, now())) {
      return c.redirect(pageUrl(code, { error: "web_login_not_pending" }));
    }
    const binding = randomToken();
    setCookie(c, BINDING_COOKIE, binding, {
      path: BINDING_COOKIE_PATH,
      httpOnly: true,
      secure: config.BETTER_AUTH_URL.startsWith("https://"),
      sameSite: "Lax",
      maxAge: Math.max(
        60,
        Math.floor((row.expiresAt.getTime() - now().getTime()) / 1000)
      ),
    });
    const codeVerifier =
      provider !== "steam" && usesPkce(provider) ? randomToken(48) : null;
    const state = await createOAuthState(deps.db, {
      row,
      code,
      provider,
      codeVerifier,
      binding,
      secret: secret(),
    });
    const target =
      provider === "steam"
        ? steamOpenIdUrl(steamReturnTo(state))
        : authorizationUrl(config, provider, { state, codeVerifier });
    return c.redirect(target);
  });

  app.get(
    "/oauth/:provider/callback",
    loginLimit("oauth-callback"),
    async (c) => {
      const provider = parseParam(c, "provider", WebLoginProvider);
      const query = parseQuery(c, OAuthCallbackQuery);
      const binding = getCookie(c, BINDING_COOKIE);
      deleteCookie(c, BINDING_COOKIE, { path: BINDING_COOKIE_PATH });
      const state = query.state
        ? await takeOAuthState(deps.db, {
            state: query.state,
            provider,
            binding,
            secret: secret(),
            now: now(),
          })
        : null;
      if (!state) {
        return c.redirect(pageUrl(null, { error: "invalid_state" }));
      }
      const back = (q: Record<string, string> = {}) =>
        c.redirect(pageUrl(state.code, q));
      if (query.error || !(provider === "steam" || query.code)) {
        return back({ error: "cancelled" });
      }
      let outcome: WebLoginOutcome;
      try {
        const login =
          provider === "steam"
            ? await verifySteamOpenId(
                deps,
                query as Record<string, string>,
                steamReturnTo(query.state as string)
              )
            : await finishOAuth(deps, provider, {
                code: query.code as string,
                codeVerifier: state.codeVerifier,
                now: now(),
              });
        outcome = await completeWebLogin(deps.db, {
          requestId: state.requestId,
          login,
          secret: secret(),
          now: now(),
        });
      } catch (err) {
        return browserError(c, err, back);
      }
      logger.info("web_login_browser_done", {
        provider,
        status: outcome.status,
      });
      return back(
        outcome.confirmSecret ? { confirm: outcome.confirmSecret } : {}
      );
    }
  );

  /** Known errors go back to the page as `?error=<code>`; everything else is a real error. */
  function browserError(
    c: Context<AppEnv>,
    err: unknown,
    back: (q: Record<string, string>) => Response
  ): Response {
    if (err instanceof ApiError && err.status < 500) {
      return back({ error: err.code });
    }
    if (err instanceof ApiError) {
      logger.warn("web_login_provider_error", {
        path: c.req.path,
        error: err.code,
      });
      return back({ error: "provider_error" });
    }
    throw err;
  }

  // --- magic link ----------------------------------------------------------------------------

  app.post(
    "/magic-link",
    rateLimit({
      limit: config.MAGIC_LINKS_PER_HOUR,
      windowMs: HOUR_MS,
      trustProxy: config.TRUST_PROXY,
      name: "magic-link",
    }),
    async (c) => {
      const body = await parseBody(c, MagicLinkRequest);
      if (!deps.mailer.enabled) {
        throw new ApiError(
          501,
          "provider_not_configured",
          "Login via email is not configured on this server"
        );
      }
      const at = now();
      const row = await findWebLogin(deps.db, body.code, secret());
      if (!row) {
        throw new ApiError(404, "web_login_not_found", "Unknown login request");
      }
      if (!isOpen(row, at)) {
        throw new ApiError(
          409,
          "web_login_not_pending",
          "This login request is finished or expired; start again in the game"
        );
      }
      const sent: MagicLinkSentResponse = { sent: true };
      // Same answer for every address: too many mails to one address and admin addresses
      // (P-037: one address per auth_users row) are silently not sent.
      const owner = await deps.db.user.findUnique({
        where: { email: body.email },
        select: { playerId: true },
      });
      if (
        mailsPerAddress.blockedFor(body.email) !== null ||
        (owner && !owner.playerId)
      ) {
        return c.json(sent, 202);
      }
      const { token } = await createMagicLink(deps.db, {
        row,
        code: body.code,
        email: body.email,
        secret: secret(),
        now: at,
      });
      const url = new URL(`${config.WEB_URL}${WEB_LOGIN_PAGE_PATH}/magic`);
      url.searchParams.set("token", token);
      await deps.mailer.send(
        magicLinkMail({
          to: body.email,
          url: url.toString(),
          code: body.code,
          intent: row.intent,
          locale: body.locale ?? (row.locale === "de" ? "de" : "en"),
        })
      );
      mailsPerAddress.hit(body.email);
      return c.json(sent, 202);
    }
  );

  /** The page behind the link shows this before the button (mail scanners only open links). */
  app.get("/magic-link/preview", async (c) => {
    const { token } = parseQuery(c, MagicLinkPreviewQuery);
    const at = now();
    const link = await peekMagicLink(deps.db, token, secret(), at);
    const row = link
      ? await deps.db.webLoginRequest.findUnique({
          where: { id: link.requestId },
          include: { player: { select: { name: true, xp: true } } },
        })
      : null;
    if (!(link && row && isOpen(row, at))) {
      throw new ApiError(400, "invalid_magic_link", "The link is not valid");
    }
    const response: MagicLinkPreview = {
      code: link.code,
      intent: row.intent,
      account: row.player
        ? { name: row.player.name, level: levelForXp(row.player.xp) }
        : null,
      expiresAt: iso(link.expiresAt),
    };
    c.header("cache-control", "no-store");
    return c.json(response);
  });

  app.post("/magic-link/verify", loginLimit("magic-link-verify"), async (c) => {
    const body = await parseBody(c, MagicLinkVerifyRequest);
    const at = now();
    const link = await takeMagicLink(deps.db, body.token, secret(), at);
    if (!link) {
      throw new ApiError(400, "invalid_magic_link", "The link is not valid");
    }
    const outcome = await completeWebLogin(deps.db, {
      requestId: link.requestId,
      login: { provider: "email", providerUserId: link.email },
      secret: secret(),
      now: at,
    });
    const row = await findWebLogin(deps.db, link.code, secret());
    if (!row) {
      throw new ApiError(400, "invalid_magic_link", "The link is not valid");
    }
    logger.info("web_login_browser_done", {
      provider: "email",
      status: outcome.status,
    });
    const response: WebLoginInfo = await info(
      row,
      link.code,
      outcome.confirmSecret
    );
    if (outcome.confirmSecret) {
      response.confirmSecret = outcome.confirmSecret;
    }
    return c.json(response);
  });

  return app;
}
