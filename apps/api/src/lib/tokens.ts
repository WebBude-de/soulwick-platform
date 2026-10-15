import { createHmac } from "node:crypto";
import { sign, verify } from "hono/jwt";

/**
 * Confirmation tokens of the website deletion (P-026). Player and admin sessions are Better Auth
 * sessions since P-027 (auth/auth.ts), the relay JWTs come from Better Auth's jwt plugin; this is
 * the only token Soulwick still signs itself.
 */
const ALG = "HS256";

// Type alias, not an interface: hono's JWTPayload needs the implicit index signature.
// biome-ignore lint/style/useConsistentTypeDefinitions: see above
export type DeletionClaims = {
  /** Row id of the deletion code the token was issued for (P-026). */
  cid: string;
  exp: number;
  iat: number;
  sub: string;
  typ: "account_deletion";
};

/**
 * Deletion tokens are signed with a key derived from the HMAC secret (lib/secrets.ts), so they
 * never match anything else signed with it.
 */
const deletionKey = (secret: string) =>
  createHmac("sha256", secret).update("account-deletion-token").digest("hex");

/** Confirmation token of the website deletion flow (POST /account-deletion/verify, P-026). */
export async function signDeletionToken(
  playerId: string,
  codeId: string,
  secret: string,
  ttlSeconds: number,
  now: Date
): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const claims: DeletionClaims = {
    sub: playerId,
    cid: codeId,
    typ: "account_deletion",
    iat,
    exp,
  };
  return {
    token: await sign(claims, deletionKey(secret), ALG),
    expiresAt: new Date(exp * 1000),
  };
}

/**
 * Player id and code row id of a deletion token, or null if it is invalid or expired. `now`
 * replaces the clock of hono/jwt, so tests with an injected clock stay deterministic.
 */
export async function verifyDeletionToken(
  token: string,
  secret: string,
  now: Date
): Promise<{ playerId: string; codeId: string } | null> {
  try {
    // Time claims are checked below against the injectable clock instead of the wall clock.
    const payload = await verify(token, deletionKey(secret), {
      alg: ALG,
      exp: false,
      iat: false,
    });
    if (
      payload.typ !== "account_deletion" ||
      typeof payload.sub !== "string" ||
      typeof payload.cid !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp * 1000 <= now.getTime()
    ) {
      return null;
    }
    return { playerId: payload.sub, codeId: payload.cid };
  } catch {
    return null;
  }
}
