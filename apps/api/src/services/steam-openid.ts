import type { Config } from "../config.ts";
import { ApiError, withCause } from "../lib/errors.ts";
import type { BaseDeps } from "../types.ts";
import type { VerifiedLogin } from "./logins.ts";

/**
 * Steam sign-in in the browser with OpenID 2.0 (D-188, P-036 (1)): the browser goes to
 * steamcommunity.com, comes back to the API with a signed assertion, and the API asks Steam
 * (`check_authentication`) whether the assertion is genuine. The SteamID64 from `claimed_id` is
 * the same `steam` identity the Steam ticket of the Steam build gives (P-014). Needs no key.
 * Steam bans are not reported this way (only the ticket says so, P-019).
 */

export const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/\d{17}$/;

export const isSteamOpenIdConfigured = (
  c: Pick<Config, "STEAM_OPENID_ENABLED">
) => c.STEAM_OPENID_ENABLED;

/** Where the browser goes; `returnTo` is the API callback including `state`. */
export function steamOpenIdUrl(returnTo: string): string {
  const realm = new URL(returnTo).origin;
  const url = new URL(STEAM_OPENID_URL);
  url.searchParams.set("openid.ns", OPENID_NS);
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.return_to", returnTo);
  url.searchParams.set("openid.realm", realm);
  url.searchParams.set("openid.identity", IDENTIFIER_SELECT);
  url.searchParams.set("openid.claimed_id", IDENTIFIER_SELECT);
  return url.toString();
}

const rejected = (why: string) =>
  withCause(
    new ApiError(
      401,
      "invalid_steam_openid",
      "Steam did not confirm the login"
    ),
    new Error(why)
  );

/**
 * Checks the assertion of the callback (`params` = all `openid.*` query values) and returns the
 * verified `steam` login. `returnTo` must be exactly the URL the flow was started with.
 * Errors: 401 `invalid_steam_openid`, 502 `steam_unavailable`.
 */
export async function verifySteamOpenId(
  deps: Pick<BaseDeps, "fetch" | "config">,
  params: Record<string, string | undefined>,
  returnTo: string
): Promise<VerifiedLogin> {
  if (params["openid.mode"] !== "id_res") {
    throw rejected(`mode ${params["openid.mode"] ?? "missing"}`);
  }
  if (params["openid.op_endpoint"] !== STEAM_OPENID_URL) {
    throw rejected("op_endpoint");
  }
  if (params["openid.return_to"] !== returnTo) {
    throw rejected("return_to");
  }
  const claimed = params["openid.claimed_id"] ?? "";
  if (!CLAIMED_ID.test(claimed) || params["openid.identity"] !== claimed) {
    throw rejected("claimed_id");
  }
  const steamId = claimed.slice(claimed.lastIndexOf("/") + 1);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith("openid.") && value !== undefined) {
      form.set(key, value);
    }
  }
  form.set("openid.mode", "check_authentication");

  const doFetch = deps.fetch ?? fetch;
  let text: string;
  try {
    const res = await doFetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(deps.config.EXTERNAL_AUTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Steam OpenID HTTP ${res.status}`);
    }
    text = await res.text();
  } catch (err) {
    throw withCause(
      new ApiError(502, "steam_unavailable", "Steam could not be reached"),
      err
    );
  }
  // Key-value form: one `key:value` per line; the nonce is spent by this check (replay-safe).
  const valid = text
    .split("\n")
    .some((line) => line.trim() === "is_valid:true");
  if (!valid) {
    throw rejected("check_authentication");
  }
  return { provider: "steam", providerUserId: steamId };
}
