import { ApiError, withCause } from "../lib/errors.ts";
import type { BaseDeps } from "../types.ts";

export const STEAM_AUTH_URL =
  "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/";

interface SteamAuthResponse {
  response?: {
    params?: {
      result?: string;
      steamid?: string;
      ownersteamid?: string;
      vacbanned?: boolean;
      publisherbanned?: boolean;
    };
    error?: { errorcode?: number; errordesc?: string };
  };
}

export function isSteamConfigured(deps: BaseDeps): boolean {
  return Boolean(deps.config.STEAM_WEB_API_KEY && deps.config.STEAM_APP_ID);
}

const unavailable = (cause: unknown) =>
  withCause(
    new ApiError(502, "steam_unavailable", "Steam could not be reached"),
    cause
  );

/**
 * Verifies a Web API session ticket (`GetAuthTicketForWebApi(identity)`, hex) via
 * ISteamUserAuth/AuthenticateUserTicket. The publisher key only works on partner.steam-api.com.
 * Returns the 64-bit Steam id of the player as a string.
 *
 * - `result != OK` or Steam's `error` object: 401 `invalid_steam_ticket` (no Steam details out).
 * - `publisherbanned` or `vacbanned` for our app: 403 `steam_banned`, no account is created.
 * - Network error, timeout, non-2xx or garbage: 502 `steam_unavailable`.
 *
 * Family sharing: the borrower plays under their own `steamid`; `ownersteamid` is not stored
 * (privacy, KONZEPT_ONLINE.md §3.2). Needs our own AppID (MP10); the test AppID 480 cannot work.
 */
export async function verifySteamTicket(
  deps: BaseDeps,
  ticket: string
): Promise<string> {
  const {
    STEAM_WEB_API_KEY,
    STEAM_APP_ID,
    STEAM_TICKET_IDENTITY,
    EXTERNAL_AUTH_TIMEOUT_MS,
  } = deps.config;
  const url = new URL(STEAM_AUTH_URL);
  url.searchParams.set("key", STEAM_WEB_API_KEY);
  url.searchParams.set("appid", STEAM_APP_ID);
  url.searchParams.set("ticket", ticket);
  if (STEAM_TICKET_IDENTITY) {
    url.searchParams.set("identity", STEAM_TICKET_IDENTITY);
  }

  const doFetch = deps.fetch ?? fetch;
  let data: SteamAuthResponse;
  try {
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(EXTERNAL_AUTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Steam answered HTTP ${res.status}`);
    }
    data = (await res.json()) as SteamAuthResponse;
  } catch (err) {
    throw unavailable(err);
  }
  if (!data || typeof data !== "object" || !data.response) {
    throw unavailable(new Error("Steam answered without `response`"));
  }

  const params = data.response.params;
  if (params?.result !== "OK" || !params.steamid) {
    throw withCause(
      new ApiError(401, "invalid_steam_ticket", "Steam rejected the ticket"),
      new Error(
        `Steam error ${data.response.error?.errorcode ?? "?"}: ${data.response.error?.errordesc ?? params?.result ?? "no result"}`
      )
    );
  }
  if (params.publisherbanned || params.vacbanned) {
    throw new ApiError(
      403,
      "steam_banned",
      "This Steam account is banned from Soulwick"
    );
  }
  return params.steamid;
}
