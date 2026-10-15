import { ApiError, withCause } from "../lib/errors.ts";
import type { BaseDeps } from "../types.ts";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const PLAY_GAMES_PLAYER_URL =
  "https://games.googleapis.com/games/v1/players/me";

export function isGooglePlayConfigured(deps: BaseDeps): boolean {
  return Boolean(
    deps.config.GOOGLE_PLAY_CLIENT_ID && deps.config.GOOGLE_PLAY_CLIENT_SECRET
  );
}

const unavailable = (cause: unknown) =>
  withCause(
    new ApiError(
      502,
      "google_play_unavailable",
      "Google Play Games could not be reached"
    ),
    cause
  );

const invalidCode = (cause: unknown) =>
  withCause(
    new ApiError(
      401,
      "invalid_google_play_code",
      "Google rejected the server auth code"
    ),
    cause
  );

/** Google answers a bad, used or expired code with 400 `invalid_grant` (401 for a bad client). */
const CODE_REJECTED_STATUS = new Set([400, 401]);

/**
 * Play Games Services v2 server-side access (KONZEPT_ONLINE.md §3.3):
 * 1. exchange the one-time server auth code at Google's OAuth token endpoint for an access token,
 * 2. ask `games/v1/players/me` with that token for the player id.
 * Only this server-side id is trusted; the device never sends a player id.
 *
 * - Code rejected (400/401 at the token endpoint, 401/403 at players/me): 401 `invalid_google_play_code`.
 * - Network error, timeout, other statuses or garbage: 502 `google_play_unavailable`.
 */
export async function verifyGooglePlayCode(
  deps: BaseDeps,
  serverAuthCode: string
): Promise<string> {
  const {
    GOOGLE_PLAY_CLIENT_ID,
    GOOGLE_PLAY_CLIENT_SECRET,
    EXTERNAL_AUTH_TIMEOUT_MS,
  } = deps.config;
  const doFetch = deps.fetch ?? fetch;

  // --- 1. code -> access token ----------------------------------------------------------------
  let tokenRes: Response;
  try {
    tokenRes = await doFetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: serverAuthCode,
        client_id: GOOGLE_PLAY_CLIENT_ID,
        client_secret: GOOGLE_PLAY_CLIENT_SECRET,
        grant_type: "authorization_code",
        // Server auth codes from Play Games are issued without a redirect URI.
        redirect_uri: "",
      }),
      signal: AbortSignal.timeout(EXTERNAL_AUTH_TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable(err);
  }
  if (CODE_REJECTED_STATUS.has(tokenRes.status)) {
    throw invalidCode(new Error(`token endpoint HTTP ${tokenRes.status}`));
  }
  let accessToken: unknown;
  try {
    if (!tokenRes.ok) {
      throw new Error(`token endpoint HTTP ${tokenRes.status}`);
    }
    const json = (await tokenRes.json()) as { access_token?: unknown } | null;
    accessToken = json?.access_token;
  } catch (err) {
    throw unavailable(err);
  }
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw unavailable(
      new Error("token endpoint answered without access_token")
    );
  }

  // --- 2. access token -> Play Games player id ----------------------------------------------
  let playerRes: Response;
  try {
    playerRes = await doFetch(PLAY_GAMES_PLAYER_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(EXTERNAL_AUTH_TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable(err);
  }
  if (playerRes.status === 401 || playerRes.status === 403) {
    throw invalidCode(new Error(`players/me HTTP ${playerRes.status}`));
  }
  let playerId: unknown;
  try {
    if (!playerRes.ok) {
      throw new Error(`players/me HTTP ${playerRes.status}`);
    }
    const json = (await playerRes.json()) as { playerId?: unknown } | null;
    playerId = json?.playerId;
  } catch (err) {
    throw unavailable(err);
  }
  if (typeof playerId !== "string" || playerId.length === 0) {
    throw unavailable(new Error("players/me answered without playerId"));
  }
  return playerId;
}
