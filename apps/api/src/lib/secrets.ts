import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
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

const ENCRYPTION_LABEL = "soulwick/token-encryption/v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const keyCache = new Map<string, Buffer>();

function encryptionKey(config: Pick<Config, "BETTER_AUTH_SECRET">): Buffer {
  const secret = config.BETTER_AUTH_SECRET;
  let key = keyCache.get(secret);
  if (!key) {
    key = createHmac("sha256", secret).update(ENCRYPTION_LABEL).digest();
    keyCache.set(secret, key);
  }
  return key;
}

/**
 * Encrypts a provider token for storage (AES-256-GCM, key derived from BETTER_AUTH_SECRET with
 * its own label; P-039). Output: base64url of iv + tag + ciphertext. Rotating the secret makes
 * stored tokens unreadable (they can then no longer be revoked).
 */
export function encryptSecret(
  config: Pick<Config, "BETTER_AUTH_SECRET">,
  plain: string
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

/** The plain text of `encryptSecret`, or null when it cannot be decrypted (other secret, damaged). */
export function decryptSecret(
  config: Pick<Config, "BETTER_AUTH_SECRET">,
  sealed: string
): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(config), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** A random URL-safe secret (poll secrets, magic links, OAuth state). */
export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString("base64url");

/**
 * HMAC of a value under a purpose prefix with the Soulwick HMAC key, for secrets that are only
 * stored as hashes (web login codes, poll and confirm secrets, magic link tokens, OAuth state).
 */
export function hashSecret(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret)
    .update(`${purpose}:${value}`)
    .digest("hex");
}
