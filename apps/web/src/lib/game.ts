import "server-only";
import { liveFeaturesEnabled } from "./features";

/** Links to the browser version of the game; both open in the same tab. */
export interface GameLinks {
  /** Opens the game's own page with the install hint already showing (`?install`). */
  install: string;
  /** Start page of the browser version. */
  play: string;
}

/**
 * Parses `GAME_URL`. Empty, unset or anything that is not an absolute http(s) URL means the
 * browser version is not available yet (`null`), so a typo hides the buttons instead of
 * rendering broken links. The install link appends the bare `install` flag the game page
 * looks for, keeping an existing query and dropping any hash.
 */
export function parseGameUrl(value: string | undefined): GameLinks | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  url.hash = "";
  const play = url.toString();
  const search = url.search === "" ? "?install" : `${url.search}&install`;
  url.search = "";
  return { play, install: `${url.toString()}${search}` };
}

/**
 * Links to the browser version (`GAME_URL`), or `null` while it is not available. Read from the
 * server environment on every call (deliberately no `NEXT_PUBLIC_`, like `LIVE_FEATURES`), so
 * Dokploy switches it with a restart instead of a rebuild. Callers render per request.
 */
export function gameLinks(): GameLinks | null {
  return parseGameUrl(process.env.GAME_URL);
}

/**
 * Play and install links as the site shows them: only while the live parts are on
 * (`LIVE_FEATURES`) and `GAME_URL` is set. Production runs with `LIVE_FEATURES=false` before the
 * release, so every play or install action turns into the "playable at release" state, whatever
 * `GAME_URL` says. Read per request like both variables.
 */
export function playLinks(): GameLinks | null {
  return liveFeaturesEnabled() ? gameLinks() : null;
}
