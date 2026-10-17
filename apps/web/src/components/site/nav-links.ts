/**
 * `[label, target]` pairs from `landing.navLinks` (header row, burger menu, footer) and
 * `landing.navExtra` (burger menu and footer only), rendered as `/${target}`: a landing anchor
 * (`#spiel`) or a page of its own (`open-source`). Header and footer show the same links in both
 * modes (`LIVE_FEATURES`): every anchor is a section that describes the game as it is at release;
 * only the live functions behind them switch off.
 */
export type NavLink = [label: string, hash: string];
