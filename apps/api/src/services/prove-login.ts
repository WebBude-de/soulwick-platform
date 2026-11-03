import type { AddLoginRequest, IdentityProvider } from "@soulwick/contracts";
import type { z } from "zod";
import { ApiError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import type { Deps } from "../types.ts";
import { verifyAppleNative } from "./apple.ts";
import { isGameCenterConfigured } from "./game-center.ts";
import { isGooglePlayConfigured, verifyGooglePlayCode } from "./google-play.ts";
import type { VerifiedLogin } from "./logins.ts";
import { isSteamConfigured, verifySteamTicket } from "./steam.ts";

const notConfigured = (provider: IdentityProvider) =>
  new ApiError(
    501,
    "provider_not_configured",
    `Login via ${provider} is not configured on this server`
  );

/**
 * POST /me/logins: checks the proof of a login inside the game with the same checks as the
 * sign-in routes and returns the verified login (KF5, P-036 (2): never a bare id).
 */
export async function proveLogin(
  deps: Deps,
  body: z.output<typeof AddLoginRequest>,
  logger: Logger
): Promise<VerifiedLogin> {
  const now = deps.now?.() ?? new Date();
  switch (body.provider) {
    case "steam":
      if (!isSteamConfigured(deps)) {
        throw notConfigured("steam");
      }
      return {
        provider: "steam",
        providerUserId: await verifySteamTicket(deps, body.ticket),
      };
    case "google_play":
      if (!isGooglePlayConfigured(deps)) {
        throw notConfigured("google_play");
      }
      return {
        provider: "google_play",
        providerUserId: await verifyGooglePlayCode(deps, body.serverAuthCode),
      };
    case "apple": {
      const { sub, account } = await verifyAppleNative(
        deps,
        deps.appleKeys,
        { ...body, now },
        logger
      );
      return {
        provider: "apple",
        providerUserId: sub,
        account: { providerId: "apple", accountId: sub, ...account },
      };
    }
    case "game_center":
      if (!isGameCenterConfigured(deps.config)) {
        throw notConfigured("game_center");
      }
      return await deps.gameCenter.verify(body, now);
    default:
      // The device id of a guest account is its only secret (P-028): knowing it is the proof.
      return { provider: "device", providerUserId: body.deviceId };
  }
}
