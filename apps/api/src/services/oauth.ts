import { createHash } from "node:crypto";
import type { WebLoginProvider } from "@soulwick/contracts";
import type { Config } from "../config.ts";
import { ApiError, withCause } from "../lib/errors.ts";
import { decodeJwt, hasValidClaims } from "../lib/jwt.ts";
import { encryptSecret } from "../lib/secrets.ts";
import type { BaseDeps } from "../types.ts";
import {
  APPLE_AUTHORIZE_URL,
  APPLE_ISSUER,
  exchangeAppleCode,
  isAppleWebConfigured,
} from "./apple.ts";
import type { VerifiedLogin } from "./logins.ts";
import { isSteamOpenIdConfigured } from "./steam-openid.ts";

/**
 * Browser sign-in with Google, Discord and Apple (KF5, P-036, P-039): OAuth 2.0 authorization
 * code flow with `state` (and PKCE S256 for Google), started and finished by the API under
 * `/auth/oauth/:provider/*`. Only the provider's stable user id is kept; the scopes ask for
 * nothing else (Google `openid`, Discord `identify`, Apple none): no names, no e-mail addresses
 * (P-036 (2), privacy for young players). Provider calls go through `deps.fetch`.
 */

export const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_USER_URL = "https://discord.com/api/users/@me";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** Discord user ids are snowflakes (decimal). */
const DISCORD_ID = /^\d{1,32}$/;

type OAuthProvider = Exclude<WebLoginProvider, "steam">;

/** Callback of a browser flow at the API (registered as redirect URI at the provider). */
export const oauthCallbackUrl = (
  config: Pick<Config, "BETTER_AUTH_URL">,
  provider: WebLoginProvider
) => `${config.BETTER_AUTH_URL}/auth/oauth/${provider}/callback`;

/** Which browser flows this environment offers (credentials set). */
export function isWebProviderConfigured(
  config: Config,
  provider: WebLoginProvider
): boolean {
  switch (provider) {
    case "google":
      return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
    case "discord":
      return Boolean(config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET);
    case "apple":
      return isAppleWebConfigured(config);
    case "steam":
      return isSteamOpenIdConfigured(config);
    default:
      return false;
  }
}

/** PKCE S256 challenge of a verifier (RFC 7636). */
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/** Whether the provider gets PKCE (documented support): Google only. */
export const usesPkce = (provider: OAuthProvider) => provider === "google";

/** The provider's authorization URL the browser is sent to. */
export function authorizationUrl(
  config: Config,
  provider: OAuthProvider,
  input: { state: string; codeVerifier: string | null }
): string {
  const redirectUri = oauthCallbackUrl(config, provider);
  let url: URL;
  switch (provider) {
    case "google":
      url = new URL(GOOGLE_AUTHORIZE_URL);
      url.searchParams.set("client_id", config.GOOGLE_CLIENT_ID);
      url.searchParams.set("scope", "openid");
      url.searchParams.set("prompt", "select_account");
      break;
    case "discord":
      url = new URL(DISCORD_AUTHORIZE_URL);
      url.searchParams.set("client_id", config.DISCORD_CLIENT_ID);
      url.searchParams.set("scope", "identify");
      break;
    default:
      url = new URL(APPLE_AUTHORIZE_URL);
      url.searchParams.set("client_id", config.APPLE_CLIENT_ID);
      // No scope: Apple then allows response_mode=query, a plain GET back to the API that
      // carries the binding cookie (SameSite=Lax); a form_post would not.
      url.searchParams.set("response_mode", "query");
      break;
  }
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", input.state);
  if (input.codeVerifier) {
    url.searchParams.set("code_challenge", pkceChallenge(input.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

const unavailable = (provider: string, cause: unknown) =>
  withCause(
    new ApiError(
      502,
      "provider_unavailable",
      `${provider} could not be reached`
    ),
    cause
  );
const rejected = (provider: string, why: string) =>
  withCause(
    new ApiError(
      401,
      "invalid_oauth_code",
      `${provider} did not confirm the login`
    ),
    new Error(why)
  );

async function postForm(
  deps: Pick<BaseDeps, "fetch" | "config">,
  provider: string,
  url: string,
  form: URLSearchParams
): Promise<Record<string, unknown>> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form,
      signal: AbortSignal.timeout(deps.config.EXTERNAL_AUTH_TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable(provider, err);
  }
  if (res.status === 400 || res.status === 401) {
    throw rejected(provider, `token endpoint HTTP ${res.status}`);
  }
  try {
    if (!res.ok) {
      throw new Error(`token endpoint HTTP ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") {
      throw new Error("token endpoint answered without JSON object");
    }
    return body as Record<string, unknown>;
  } catch (err) {
    throw unavailable(provider, err);
  }
}

/** Claims of an id token from the token endpoint (direct TLS answer: OIDC Core 3.1.3.7). */
function idTokenClaims(
  provider: string,
  body: Record<string, unknown>,
  expected: { issuers: string[]; audience: string; now: Date }
): Record<string, unknown> {
  const jwt =
    typeof body.id_token === "string" ? decodeJwt(body.id_token) : null;
  if (!jwt) {
    throw unavailable(provider, new Error("answer without id_token"));
  }
  const ok = hasValidClaims(jwt.payload, {
    issuers: expected.issuers,
    audiences: [expected.audience],
    nowSeconds: Math.floor(expected.now.getTime() / 1000),
  });
  if (!(ok && typeof jwt.payload.sub === "string" && jwt.payload.sub)) {
    throw rejected(provider, "id token claims");
  }
  return jwt.payload;
}

/**
 * Finishes a browser flow: exchanges the code and returns the verified login (`google`, `discord`,
 * `apple` with the provider user id; Apple also an encrypted refresh token for revocation).
 * Errors: 401 `invalid_oauth_code` / `invalid_apple_token`, 502 `provider_unavailable` /
 * `apple_unavailable`.
 */
export async function finishOAuth(
  deps: Pick<BaseDeps, "fetch" | "config">,
  provider: OAuthProvider,
  input: { code: string; codeVerifier: string | null; now: Date }
): Promise<VerifiedLogin> {
  const { config } = deps;
  const redirectUri = oauthCallbackUrl(config, provider);
  if (provider === "apple") {
    const tokens = await exchangeAppleCode(deps, {
      code: input.code,
      clientId: config.APPLE_CLIENT_ID,
      redirectUri,
      now: input.now,
    });
    const sub = tokens.idToken.sub;
    const ok = hasValidClaims(tokens.idToken, {
      issuers: [APPLE_ISSUER],
      audiences: [config.APPLE_CLIENT_ID],
      nowSeconds: Math.floor(input.now.getTime() / 1000),
    });
    if (!(ok && typeof sub === "string" && sub)) {
      throw rejected("Apple", "id token claims");
    }
    return {
      provider: "apple",
      providerUserId: sub,
      account: {
        providerId: "apple",
        accountId: sub,
        clientId: config.APPLE_CLIENT_ID,
        refreshToken: tokens.refreshToken
          ? encryptSecret(config, tokens.refreshToken)
          : null,
      },
    };
  }
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
  });
  if (input.codeVerifier) {
    form.set("code_verifier", input.codeVerifier);
  }
  if (provider === "google") {
    form.set("client_id", config.GOOGLE_CLIENT_ID);
    form.set("client_secret", config.GOOGLE_CLIENT_SECRET);
    const body = await postForm(deps, "Google", GOOGLE_OAUTH_TOKEN_URL, form);
    const claims = idTokenClaims("Google", body, {
      issuers: GOOGLE_ISSUERS,
      audience: config.GOOGLE_CLIENT_ID,
      now: input.now,
    });
    return {
      provider: "google",
      providerUserId: claims.sub as string,
      account: { providerId: "google", accountId: claims.sub as string },
    };
  }
  form.set("client_id", config.DISCORD_CLIENT_ID);
  form.set("client_secret", config.DISCORD_CLIENT_SECRET);
  const body = await postForm(deps, "Discord", DISCORD_TOKEN_URL, form);
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw unavailable("Discord", new Error("answer without access_token"));
  }
  const id = await discordUserId(deps, accessToken);
  return {
    provider: "discord",
    providerUserId: id,
    account: { providerId: "discord", accountId: id },
  };
}

async function discordUserId(
  deps: Pick<BaseDeps, "fetch" | "config">,
  accessToken: string
): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(DISCORD_USER_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(deps.config.EXTERNAL_AUTH_TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable("Discord", err);
  }
  if (res.status === 401 || res.status === 403) {
    throw rejected("Discord", `users/@me HTTP ${res.status}`);
  }
  let id: unknown;
  try {
    if (!res.ok) {
      throw new Error(`users/@me HTTP ${res.status}`);
    }
    id = ((await res.json()) as { id?: unknown } | null)?.id;
  } catch (err) {
    throw unavailable("Discord", err);
  }
  if (typeof id !== "string" || !DISCORD_ID.test(id)) {
    throw unavailable("Discord", new Error("users/@me without id"));
  }
  return id;
}
