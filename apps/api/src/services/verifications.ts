import type { Db } from "./db-types.ts";

/**
 * One-time values in Better Auth's `auth_verifications` (KF5, P-039): OAuth `state`, magic links
 * and Apple nonces. The identifier is `<prefix><HMAC of the secret>`, so the table never holds a
 * usable secret; `takeVerification` uses a value up atomically.
 */

/** Prefixes of our rows (swept by the housekeeping when expired). */
export const VERIFICATION_PREFIXES = [
  "oauth-state:",
  "magic-link:",
  "apple-nonce:",
] as const;

export async function putVerification(
  db: Db,
  input: { identifier: string; value: unknown; expiresAt: Date }
): Promise<void> {
  await db.verification.create({
    data: {
      identifier: input.identifier,
      value: JSON.stringify(input.value),
      expiresAt: input.expiresAt,
    },
  });
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Takes a value out atomically (delete ... returning): two parallel uses of the same state, link
 * or nonce cannot both get it. Expired values count as missing.
 */
export async function takeVerification(
  db: Db,
  identifier: string,
  now: Date
): Promise<unknown> {
  const rows = await db.$queryRaw<{ value: string; expires_at: Date }[]>`
    delete from auth_verifications where identifier = ${identifier}
    returning value, expires_at`;
  const row = rows[0];
  return row && row.expires_at > now ? parse(row.value) : null;
}

/** Reads a value without using it up (magic link preview); null if missing or expired. */
export async function peekVerification(
  db: Db,
  identifier: string,
  now: Date
): Promise<{ value: unknown; expiresAt: Date } | null> {
  const row = await db.verification.findFirst({
    where: { identifier, expiresAt: { gt: now } },
  });
  return row ? { value: parse(row.value), expiresAt: row.expiresAt } : null;
}

/** Housekeeping: our expired rows. */
export async function deleteExpiredVerifications(
  db: Db,
  now: Date
): Promise<number> {
  const { count } = await db.verification.deleteMany({
    where: {
      expiresAt: { lt: now },
      OR: VERIFICATION_PREFIXES.map((prefix) => ({
        identifier: { startsWith: prefix },
      })),
    },
  });
  return count;
}
