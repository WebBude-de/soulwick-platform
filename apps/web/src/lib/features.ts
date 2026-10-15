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
 * Whether the online parts of the site exist: `/leaderboards`, `/guilds/[tag]`, the leaderboard
 * teaser on the landing page and every link to them. Production runs as a pure teaser until the
 * online part is live (`LIVE_FEATURES=false`).
 *
 * Read from the server environment on every call (deliberately no `NEXT_PUBLIC_`), so Dokploy can
 * flip it with a restart instead of a rebuild. Callers must render per request (`dynamic =
 * "force-dynamic"` or a request API such as cookies), otherwise the build would bake the value in.
 */
export function liveFeaturesEnabled(): boolean {
  return parseLiveFeatures(process.env.LIVE_FEATURES);
}
