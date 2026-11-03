import { expect } from "bun:test";
import type { TestContext } from "./helpers.ts";

/**
 * Drives the web login like game and browser do (KF5, P-039): start in the game, browser flow
 * with the browser secret `k`, confirmation with the code the game shows, collect by polling.
 */

export interface StartedWebLogin {
  browserSecret: string;
  /** From POST /auth/web-login/claim (empty with `claim: false`). */
  browserToken: string;
  code: string;
  pollSecret: string;
  url: string;
  userCode: string;
}

/** Starts a request and (unless `claim: false`) trades `k` for the browser token like the page. */
export async function startWebLogin(
  ctx: TestContext,
  opts: { token?: string; link?: boolean; claim?: boolean } = {}
): Promise<StartedWebLogin> {
  const res = await ctx.req("POST", "/auth/web-login", {
    token: opts.token,
    body: opts.link ? { intent: "link" } : {},
  });
  expect(res.status).toBe(201);
  const started = { ...res.json, browserToken: "" } as StartedWebLogin;
  if (opts.claim === false) {
    return started;
  }
  const claimed = await ctx.req("POST", "/auth/web-login/claim", {
    body: { code: started.code, k: started.browserSecret },
  });
  expect(claimed.status).toBe(200);
  return { ...started, browserToken: claimed.json.browserToken };
}

/** GET /auth/web-login/:code with the browser token header and/or `?confirm=`. */
export const webLoginInfo = (
  ctx: TestContext,
  code: string,
  opts: { browserToken?: string; confirm?: string | null } = {}
) =>
  ctx.req(
    "GET",
    `/auth/web-login/${code}${opts.confirm ? `?confirm=${opts.confirm}` : ""}`,
    {
      headers: opts.browserToken
        ? { "x-browser-token": opts.browserToken }
        : {},
    }
  );

/** The page's form post that starts a browser flow (303 to the provider or back). */
export const oauthStart = (
  ctx: TestContext,
  provider: string,
  code: string,
  browserToken: string
) =>
  ctx.app.request(`/auth/oauth/${provider}/start`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, browserToken }).toString(),
  });

export const pollWebLogin = (ctx: TestContext, req: StartedWebLogin) =>
  ctx.req("POST", "/auth/web-login/poll", {
    body: { code: req.code, pollSecret: req.pollSecret },
  });

/**
 * Start + provider callback like a browser; `answer` builds the provider's callback query.
 * Returns the URL the browser lands on (`?confirm=` after a proven login).
 */
export async function browserFlow(
  ctx: TestContext,
  provider: string,
  req: Pick<StartedWebLogin, "code" | "browserToken">,
  answer: (providerUrl: URL) => Record<string, string>,
  opts: { dropCookie?: boolean } = {}
) {
  const start = await oauthStart(ctx, provider, req.code, req.browserToken);
  expect(start.status).toBe(303);
  const providerUrl = new URL(start.headers.get("location") ?? "");
  const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const query = new URLSearchParams(answer(providerUrl));
  const state = providerUrl.searchParams.get("state");
  if (state && !query.has("state")) {
    query.set("state", state);
  }
  const callback = await ctx.app.request(
    `/auth/oauth/${provider}/callback?${query}`,
    { headers: opts.dropCookie ? {} : { cookie } }
  );
  expect(callback.status).toBe(302);
  const back = new URL(callback.headers.get("location") ?? "");
  return {
    providerUrl,
    cookie,
    back,
    confirmSecret: back.searchParams.get("confirm"),
  };
}

export const confirmWebLogin = (
  ctx: TestContext,
  code: string,
  confirmSecret: string,
  typedCode: string
) =>
  ctx.req("POST", "/auth/web-login/confirm", {
    body: { code, confirmSecret, typedCode },
  });

/** Browser flow, confirmation with the right code, then the game's poll answer. */
export async function completeFlow(
  ctx: TestContext,
  provider: string,
  req: StartedWebLogin,
  answer: (providerUrl: URL) => Record<string, string>
) {
  const flow = await browserFlow(ctx, provider, req, answer);
  expect(flow.confirmSecret).not.toBeNull();
  const confirmed = await confirmWebLogin(
    ctx,
    req.code,
    flow.confirmSecret ?? "",
    req.userCode
  );
  expect(confirmed.status).toBe(200);
  return { flow, confirmed, polled: await pollWebLogin(ctx, req) };
}
