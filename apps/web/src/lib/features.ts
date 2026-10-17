import "server-only";

const ON_VALUES = new Set(["true", "1", "on", "yes"]);

/**
 * Parses `LIVE_FEATURES`. Unset or empty means on (development keeps everything); `true`, `1`,
 * `on`, `yes` (any case) mean on; every other value, e.g. `false`, means off, so a typo in
 * production hides the online parts instead of showing empty boards.
 */
export function parseLiveFeatures(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "" || ON_VALUES.has(normalized);
}

/**
 * Whether the live functions of the site are on: playing and installing the browser version
 * (with `GAME_URL`, see `playLinks`), `/leaderboards`, `/guilds/[tag]`, the live boards on the
 * landing page and every link to them. Production runs with `LIVE_FEATURES=false` until the
 * release: the page still describes the whole game as it is at release, only these functions
 * are off (no dead links, "playable at release" instead of a play button).
 *
 * Read from the server environment on every call (deliberately no `NEXT_PUBLIC_`), so Dokploy can
 * flip it with a restart instead of a rebuild. Callers must render per request (`dynamic =
 * "force-dynamic"` or a request API such as cookies), otherwise the build would bake the value in.
 */
export function liveFeaturesEnabled(): boolean {
  return parseLiveFeatures(process.env.LIVE_FEATURES);
}
