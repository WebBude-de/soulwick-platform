/**
 * Password of the seeded player login (Lumen, KF5): the well-known local default only for a
 * database on this machine; elsewhere (e.g. the development server, where DOKPLOY.md allows the
 * dev seed with NODE_ENV=development) only an explicit DEV_PLAYER_PASSWORD (min. 12 characters),
 * otherwise no password login is seeded. A public server must never have an account with a
 * password that stands in the repository (KF5 security fix).
 */
export const LOCAL_PLAYER_PASSWORD = "soulwick-player-local";
const MIN_LENGTH = 12;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function seedPlayerPassword(env: {
  DATABASE_URL?: string;
  DEV_PLAYER_PASSWORD?: string;
}): { password: string; local: boolean } | null {
  const explicit = env.DEV_PLAYER_PASSWORD?.trim() ?? "";
  if (explicit.length >= MIN_LENGTH && explicit !== LOCAL_PLAYER_PASSWORD) {
    return { password: explicit, local: false };
  }
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
  return LOOPBACK_HOSTS.has(host)
    ? { password: LOCAL_PLAYER_PASSWORD, local: true }
    : null;
}
