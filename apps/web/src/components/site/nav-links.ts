/**
 * `[label, target]` pairs from `landing.navLinks`, rendered as `/${target}`: a landing anchor
 * (`#spiel`) or a page of its own (`open-source`).
 */
export type NavLink = [label: string, hash: string];

/** Landing anchors that only exist while the online parts are live (see `liveFeaturesEnabled`). */
const LIVE_ONLY_HASHES = new Set(["#ranglisten"]);

/** Navigation entries for header and footer; drops the leaderboards anchor in teaser mode. */
export function visibleNavLinks(links: NavLink[], live: boolean): NavLink[] {
  return live ? links : links.filter(([, hash]) => !LIVE_ONLY_HASHES.has(hash));
}
