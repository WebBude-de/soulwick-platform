import { createHmac } from "node:crypto";
import type { Config } from "../config.ts";

/** Fixed label of the derivation; a new version would give new keys. */
const LABEL = "soulwick/hmac/v1";

const cache = new Map<string, string>();

/**
 * Key of the Soulwick HMACs (P-027): link codes, deletion codes, the confirmation token of the
 * website deletion and `account_deletions.player_hash`. Each of those adds its own prefix to the
 * message (or derives once more), so they stay apart from each other. Before Better Auth this was
 * TOKEN_SECRET; now it is derived from BETTER_AUTH_SECRET, which keeps it apart from what Better
 * Auth signs and encrypts with the same secret (session tokens, JWT signing keys) and leaves one
 * secret per environment.
 *
 * Rotating BETTER_AUTH_SECRET ends all sessions, makes the stored JWT signing keys unreadable,
 * voids open link and deletion codes and changes `player_hash` of later deletion log rows (older
 * rows can then no longer be found by player id).
 */
export function hmacSecret(config: Pick<Config, "BETTER_AUTH_SECRET">): string {
  const secret = config.BETTER_AUTH_SECRET;
  let key = cache.get(secret);
  if (!key) {
    key = createHmac("sha256", secret).update(LABEL).digest("hex");
    cache.set(secret, key);
  }
  return key;
}
