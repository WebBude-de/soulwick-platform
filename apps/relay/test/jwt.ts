import { PLAYER_JWT_AUDIENCE } from "@soulwick/contracts";
import {
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";
import { createJwksVerifier, type PlayerTokenVerifier } from "../src/auth.ts";
import type { Logger } from "../src/logger.ts";

/**
 * Stand-in for the API's player JWTs (P-027): Ed25519 keys like Better Auth's jwt plugin, a JWKS
 * as GET /auth/jwks serves it and a fake fetch for the relay's key set cache.
 */

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export async function createTestKey(kid: string): Promise<TestKey> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "EdDSA" };
  return { kid, privateKey, publicJwk };
}

/** The key the fake API publishes by default. */
export const API_KEY = await createTestKey("test-key-1");
/** A key the API never published. */
export const FOREIGN_KEY = await createTestKey("foreign-key");

export const ISSUER = "http://localhost:3101";
export const JWKS_URL = "http://api.test/auth/jwks";

export async function signPlayerJwt(
  playerId: string,
  opts: {
    audience?: string;
    /** Seconds; negative = already expired. */
    expiresIn?: number;
    key?: TestKey;
    /** Header `kid` (defaults to the key's id). */
    kid?: string;
    claims?: JWTPayload;
  } = {}
): Promise<string> {
  const key = opts.key ?? API_KEY;
  const iat = Math.floor(Date.now() / 1000);
  return await new SignJWT({ name: "Test", ...opts.claims })
    .setProtectedHeader({ alg: "EdDSA", kid: opts.kid ?? key.kid })
    .setSubject(playerId)
    .setIssuer(ISSUER)
    .setAudience(opts.audience ?? PLAYER_JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.expiresIn ?? 900))
    .sign(key.privateKey);
}

/** Fake `fetch` that serves a JWKS; tests change `keys`, `down` and read `calls`. */
export function fakeJwks(keys: TestKey[] = [API_KEY]) {
  const state: { keys: TestKey[]; down: boolean; calls: number } = {
    keys,
    down: false,
    calls: 0,
  };
  const fetchLike = (input: string | URL) => {
    state.calls += 1;
    if (String(input) !== JWKS_URL) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (state.down) {
      return Promise.reject(new TypeError("connection refused"));
    }
    return Promise.resolve(
      Response.json({ keys: state.keys.map((k) => k.publicJwk) })
    );
  };
  return { state, fetch: fetchLike as unknown as typeof fetch };
}

export function testTokenVerifier(
  logger: Logger,
  opts: {
    fetch?: typeof fetch;
    now?: () => number;
    cacheMs?: number;
    cooldownMs?: number;
  } = {}
): PlayerTokenVerifier {
  return createJwksVerifier({
    url: JWKS_URL,
    fetch: opts.fetch ?? fakeJwks().fetch,
    now: opts.now,
    cacheMs: opts.cacheMs ?? 600_000,
    cooldownMs: opts.cooldownMs ?? 30_000,
    timeoutMs: 500,
    logger,
  });
}
