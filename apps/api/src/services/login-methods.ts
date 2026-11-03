import { type LoginMethod, WebLoginProvider } from "@soulwick/contracts";
import type { Deps } from "../types.ts";
import { isAppleNativeConfigured } from "./apple.ts";
import { isGameCenterConfigured } from "./game-center.ts";
import { isGooglePlayConfigured } from "./google-play.ts";
import { isWebProviderConfigured } from "./oauth.ts";
import { isSteamConfigured } from "./steam.ts";

/**
 * Login methods configured in this environment (`GET /public/config` `loginMethods`, KF5): a
 * provider without its variables is off and not listed. Username + password needs nothing.
 */
export function loginMethods(deps: Deps): LoginMethod[] {
  const { config } = deps;
  const methods: LoginMethod[] = [];
  if (config.GUEST_AUTH_ENABLED) {
    methods.push("device");
  }
  methods.push("password");
  if (deps.mailer.enabled) {
    methods.push("email");
  }
  for (const provider of WebLoginProvider.options) {
    if (isWebProviderConfigured(config, provider)) {
      methods.push(provider);
    }
  }
  if (isSteamConfigured(deps)) {
    methods.push("steam_ticket");
  }
  if (isGooglePlayConfigured(deps)) {
    methods.push("google_play");
  }
  if (isAppleNativeConfigured(config)) {
    methods.push("apple_native");
  }
  if (isGameCenterConfigured(config)) {
    methods.push("game_center");
  }
  return methods;
}
