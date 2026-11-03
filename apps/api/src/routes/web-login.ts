import {
  levelForXp,
  type MagicLinkPreview,
  MagicLinkPreviewQuery,
  MagicLinkRequest,
  type MagicLinkSentResponse,
  MagicLinkVerifyRequest,
  OAuthCallbackQuery,
  OAuthStartForm,
  WEB_LOGIN_BROWSER_TOKEN_HEADER,
  WEB_LOGIN_PAGE_PATH,
  WEB_LOGIN_POLL_INTERVAL_SECONDS,
  WebLoginClaimRequest,
  type WebLoginClaimResponse,
  WebLoginCode,
  WebLoginConfirmRequest,
  type WebLoginInfo,
  WebLoginInfoQuery,
  WebLoginPollRequest,
  type WebLoginPollResponse,
  WebLoginProvider,
  WebLoginStartRequest,
  type WebLoginStartResponse,
} from "@soulwick/contracts";
import type { Player, WebLoginRequest } from "@soulwick/db";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { proxyTrust } from "../lib/client-ip.ts";
import { ApiError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { fixedWindowCounter, rateLimit } from "../lib/rate-limit.ts";
import { hmacSecret, randomToken } from "../lib/secrets.ts";
import {
  iso,
  isoOrNull,
  parseBody,
  parseForm,
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
  claimWebLogin,
  collectWebLogin,
  confirmWebLogin,
  createMagicLink,
  createOAuthState,
  createWebLogin,
  findWebLogin,
  formatCode,
  hasBrowserToken,
  isOpen,
  peekMagicLink,
  proveWebLogin,
  takeMagicLink,
  takeOAuthState,
  webLoginInfo,
} from "../services/web-login.ts";
import type { AppEnv, Deps } from "../types.ts";

/** Cookie that binds a browser flow to the browser that started it (login CSRF protection). */
const BINDING_COOKIE = "sw_oauth_binding";
const BINDING_COOKIE_PATH = "/auth/oauth";
const HOUR_MS = 3_600_000;

const notFound = () =>
  new ApiError(404, "web_login_not_found", "Unknown login request");

/**
 * Web login from the game and the browser flows (KF5, P-036 (3), P-039), mounted under /auth:
 * - `POST /web-login`, `POST /web-login/claim`, `POST /web-login/poll`, `GET /web-login/:code`,
 *   `POST /web-login/confirm`;
 * - `POST /oauth/:provider/start` (form post) and `GET /oauth/:provider/callback` for Google,
 *   Apple, Discord and Steam OpenID;
 * - `POST /magic-link`, `GET /magic-link/preview`, `POST /magic-link/verify`.
 * A proven login is only parked; the browser that proved it confirms with the code from the game
 * (`/web-login/confirm`). The website (KF11) renders `/login/<code>` and `/login/magic`.
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
      trustProxy: proxyTrust(config),
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
    row: WebLoginRequest,
    code: string,
    keys: { browserToken?: string; confirmSecret?: string }
  ) =>
    await webLoginInfo(deps.db, row, {
      code,
      ...keys,
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
        userCode: formatCode(created.userCode),
        pollSecret: created.pollSecret,
        browserSecret: created.browserSecret,
        // The browser secret goes in the fragment: browsers never send it to a server.
        url: `${pageUrl(created.code)}#k=${created.browserSecret}`,
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

  /**
   * The website trades the browser secret `k` from the URL fragment once for a browser token;
   * afterwards `k` (in history, on screen, in a log) starts nothing.
   */
  app.post("/web-login/claim", loginLimit("web-login-claim"), async (c) => {
    const body = await parseBody(c, WebLoginClaimRequest);
    const claimed = await claimWebLogin(deps.db, {
      code: body.code,
      k: body.k,
      secret: secret(),
      now: now(),
    });
    const response: WebLoginClaimResponse = {
      browserToken: claimed.browserToken,
      expiresAt: iso(claimed.expiresAt),
    };
    c.header("cache-control", "no-store");
    return c.json(response);
  });

  /**
   * For the website page `/login/<code>`: with the header `x-browser-token` the request details,
   * with `?confirm=` also the account data, without either only status and expiry.
   */
  app.get("/web-login/:code", loginLimit("web-login-info"), async (c) => {
    const code = parseParam(c, "code", WebLoginCode);
    const { confirm } = parseQuery(c, WebLoginInfoQuery);
    const browserToken =
      c.req.header(WEB_LOGIN_BROWSER_TOKEN_HEADER) || undefined;
    const row = await findWebLogin(deps.db, code, secret());
    if (!row) {
      throw notFound();
    }
    c.header("cache-control", "no-store");
    return c.json(
      await info(row, code, { browserToken, confirmSecret: confirm })
    );
  });

  /**
   * The browser that proved the login confirms with the code the game shows; only now the login
   * is applied (sign-in, added login, absorbed or merged account).
   */
  app.post("/web-login/confirm", loginLimit("web-login-confirm"), async (c) => {
    const body = await parseBody(c, WebLoginConfirmRequest);
    const row = await confirmWebLogin(deps.db, {
      code: body.code,
      confirmSecret: body.confirmSecret,
      typedCode: body.typedCode,
      secret: secret(),
      now: now(),
    });
    logger.info("web_login_confirmed", {
      intent: row.intent,
      provider: row.provider,
      status: row.status,
      merged: row.merged,
      error: row.error ?? undefined,
    });
    return c.json(
      await info(row, body.code, { confirmSecret: body.confirmSecret })
    );
  });

  // --- browser flows: Google, Apple, Discord, Steam OpenID ---------------------------------------

  /**
   * A form post of the website page (never a link: the token must not end up in a URL). Answers
   * 303 to the provider, or back to the page with `?error=`.
   */
  app.post("/oauth/:provider/start", loginLimit("oauth-start"), async (c) => {
    const provider = parseParam(c, "provider", WebLoginProvider);
    const { code, browserToken } = await parseForm(c, OAuthStartForm);
    const row = await findWebLogin(deps.db, code, secret());
    // The code alone is not enough (it may be on a stream or in a forwarded link): the browser
    // token the page got for the secret from the URL fragment has to come along.
    if (!(row && hasBrowserToken(row, browserToken, secret()))) {
      return c.redirect(pageUrl(null, { error: "web_login_not_found" }), 303);
    }
    if (!isWebProviderConfigured(config, provider)) {
      return c.redirect(
        pageUrl(code, { error: "provider_not_configured" }),
        303
      );
    }
    if (!isOpen(row, now())) {
      return c.redirect(pageUrl(code, { error: "web_login_not_pending" }), 303);
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
    return c.redirect(target, 303);
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
      let confirmSecret: string;
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
        ({ confirmSecret } = await proveWebLogin(deps.db, {
          requestId: state.requestId,
          login,
          secret: secret(),
          now: now(),
        }));
      } catch (err) {
        return browserError(c, err, back);
      }
      logger.info("web_login_proven", { provider });
      // Nothing is finished yet: the page asks for the code from the game.
      return back({ confirm: confirmSecret });
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
      trustProxy: proxyTrust(config),
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
      if (!(row && hasBrowserToken(row, body.browserToken, secret()))) {
        throw notFound();
      }
      if (!isOpen(row, at)) {
        throw new ApiError(
          409,
          "web_login_not_pending",
          "This login request is finished or expired; start again in the game"
        );
      }
      // The answer never depends on the address and never waits for the mail: account lookup,
      // link and sending run after it (timing oracle; errors only in the log).
      const limited = mailsPerAddress.blockedFor(body.email) !== null;
      if (!limited) {
        mailsPerAddress.hit(body.email);
        sendMagicLinkLater({
          row,
          code: body.code,
          email: body.email,
          locale: body.locale ?? (row.locale === "de" ? "de" : "en"),
          now: at,
        });
      }
      const sent: MagicLinkSentResponse = { sent: true };
      return c.json(sent, 202);
    }
  );

  /** Admin addresses (P-037: one address per auth_users row) silently get no mail. */
  function sendMagicLinkLater(input: {
    row: WebLoginRequest;
    code: string;
    email: string;
    locale: "en" | "de";
    now: Date;
  }): void {
    const run = async () => {
      const owner = await deps.db.user.findUnique({
        where: { email: input.email },
        select: { playerId: true },
      });
      if (owner && !owner.playerId) {
        return;
      }
      const { token } = await createMagicLink(deps.db, {
        row: input.row,
        code: input.code,
        email: input.email,
        secret: secret(),
        now: input.now,
      });
      const url = new URL(`${config.WEB_URL}${WEB_LOGIN_PAGE_PATH}/magic`);
      url.searchParams.set("token", token);
      await deps.mailer.send(
        magicLinkMail({
          to: input.email,
          url: url.toString(),
          intent: input.row.intent,
          locale: input.locale,
        })
      );
    };
    run().catch((err: unknown) => {
      logger.error("magic_link_send_failed", {
        error: err instanceof ApiError ? err.code : String(err),
        cause:
          err instanceof Error && err.cause instanceof Error
            ? err.cause.message
            : undefined,
      });
    });
  }

  /** The page behind the link shows this before the button (mail scanners only open links). */
  app.get(
    "/magic-link/preview",
    loginLimit("magic-link-preview"),
    async (c) => {
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
        intent: row.intent,
        account: row.player
          ? { name: row.player.name, level: levelForXp(row.player.xp) }
          : null,
        expiresAt: iso(link.expiresAt),
      };
      c.header("cache-control", "no-store");
      return c.json(response);
    }
  );

  /** The button: proves the address; the page then asks for the code from the game. */
  app.post("/magic-link/verify", loginLimit("magic-link-verify"), async (c) => {
    const body = await parseBody(c, MagicLinkVerifyRequest);
    const at = now();
    const link = await takeMagicLink(deps.db, body.token, secret(), at);
    if (!link) {
      throw new ApiError(400, "invalid_magic_link", "The link is not valid");
    }
    const { confirmSecret } = await proveWebLogin(deps.db, {
      requestId: link.requestId,
      login: { provider: "email", providerUserId: link.email },
      secret: secret(),
      now: at,
    });
    const row = await findWebLogin(deps.db, link.code, secret());
    if (!row) {
      throw new ApiError(400, "invalid_magic_link", "The link is not valid");
    }
    logger.info("web_login_proven", { provider: "email" });
    const response: WebLoginInfo = {
      ...(await info(row, link.code, { confirmSecret })),
      confirmSecret,
    };
    return c.json(response);
  });

  return app;
}
