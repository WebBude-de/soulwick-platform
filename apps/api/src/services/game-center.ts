import { verify, X509Certificate } from "node:crypto";
import type { GameCenterAuthRequest } from "@soulwick/contracts";
import { ApiError, withCause } from "../lib/errors.ts";
import type { BaseDeps } from "../types.ts";
import { GAME_CENTER_CAS } from "./game-center-cas.ts";
import type { VerifiedLogin } from "./logins.ts";

/**
 * Game Center sign-in of the iOS app (KONZEPT_ONLINE.md §3.4, KF5, P-039). GameKit's
 * `fetchItems(forIdentityVerificationSignature:)` gives a certificate URL, a signature, a salt
 * and a timestamp. The server accepts only `https://static.gc.apple.com/public-key/...`, loads it
 * without following redirects, checks that the certificate is Apple's and chains up to the
 * DigiCert root (`game-center-cas.ts`), checks the bundle id against GAME_CENTER_BUNDLE_IDS, the
 * age of the timestamp and the RSA-SHA256 signature over teamPlayerID + bundle id + timestamp
 * (uint64 big endian) + salt.
 */

/** TESTWERT: how old the signature's timestamp may be. */
export const GAME_CENTER_MAX_AGE_SECONDS = 600;
/** TESTWERT: certificates are cached this long per URL. */
const CERT_CACHE_MS = 24 * 3_600_000;
/** At most this many certificates in the cache (Apple uses one or two at a time). */
const CERT_CACHE_MAX = 8;
export const GAME_CENTER_CERT_HOST = "static.gc.apple.com";
const CERT_PATH_PREFIX = "/public-key/";
const MAX_CHAIN = 4;
/** Subject of Apple's Game Center signing certificate. */
const APPLE_ORGANIZATION = "O=Apple Inc.";

const invalid = (why: string) =>
  withCause(
    new ApiError(
      401,
      "invalid_game_center_signature",
      "Game Center did not confirm the login"
    ),
    new Error(why)
  );

export function isGameCenterConfigured(config: {
  GAME_CENTER_BUNDLE_IDS: string[];
}): boolean {
  return config.GAME_CENTER_BUNDLE_IDS.length > 0;
}

/** Only `https://static.gc.apple.com/public-key/<file>` (no port, no credentials). */
export function trustedCertUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const ok =
      url.protocol === "https:" &&
      url.hostname === GAME_CENTER_CERT_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.startsWith(CERT_PATH_PREFIX);
    return ok ? url : null;
  } catch {
    return null;
  }
}

const validAt = (cert: X509Certificate, now: Date) =>
  now.getTime() >= Date.parse(cert.validFrom) &&
  now.getTime() <= Date.parse(cert.validTo);

/**
 * Whether `leaf` chains up to a self-signed root among `cas` (each link: issuer name matches, the
 * signature verifies, the issuer is a CA and valid now).
 */
export function chainsToRoot(
  leaf: X509Certificate,
  cas: readonly X509Certificate[],
  now: Date
): boolean {
  let current = leaf;
  for (let depth = 0; depth < MAX_CHAIN; depth += 1) {
    const issuer = cas.find(
      (ca) =>
        ca.ca &&
        validAt(ca, now) &&
        current.checkIssued(ca) &&
        current.verify(ca.publicKey)
    );
    if (!issuer) {
      return false;
    }
    if (issuer.checkIssued(issuer) && issuer.verify(issuer.publicKey)) {
      return true;
    }
    current = issuer;
  }
  return false;
}

type GameCenterProof = Omit<GameCenterAuthRequest, "name" | "appearance">;

/**
 * Game Center check with a certificate cache per app instance. `deps.gameCenterCas` replaces
 * the DigiCert chain in tests.
 */
export function createGameCenterVerifier(
  deps: Pick<BaseDeps, "fetch" | "config" | "gameCenterCas">
) {
  const cas = (deps.gameCenterCas ?? GAME_CENTER_CAS).map(
    (pem) => new X509Certificate(pem)
  );
  const certs = new Map<string, { cert: X509Certificate; at: number }>();

  function remember(href: string, cert: X509Certificate) {
    certs.delete(href);
    certs.set(href, { cert, at: Date.now() });
    // Map keeps insertion order: drop the oldest beyond the cap.
    for (const key of certs.keys()) {
      if (certs.size <= CERT_CACHE_MAX) {
        break;
      }
      certs.delete(key);
    }
  }

  async function certificate(url: URL, now: Date): Promise<X509Certificate> {
    const cached = certs.get(url.href);
    if (cached && Date.now() - cached.at < CERT_CACHE_MS) {
      return cached.cert;
    }
    const doFetch = deps.fetch ?? fetch;
    let cert: X509Certificate;
    try {
      const res = await doFetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(deps.config.EXTERNAL_AUTH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`certificate HTTP ${res.status}`);
      }
      cert = new X509Certificate(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      throw withCause(
        new ApiError(
          502,
          "game_center_unavailable",
          "The Game Center certificate could not be loaded"
        ),
        err
      );
    }
    // Only certificates Apple got from the trusted CA ever enter the cache.
    if (
      !(
        validAt(cert, now) &&
        cert.subject.split("\n").includes(APPLE_ORGANIZATION) &&
        chainsToRoot(cert, cas, now)
      )
    ) {
      throw invalid("certificate not from Apple's CA");
    }
    remember(url.href, cert);
    return cert;
  }

  return {
    /** Returns the verified `game_center` login (teamPlayerID). */
    async verify(proof: GameCenterProof, now: Date): Promise<VerifiedLogin> {
      if (!deps.config.GAME_CENTER_BUNDLE_IDS.includes(proof.bundleId)) {
        throw invalid("bundle id");
      }
      const ageMs = now.getTime() - proof.timestamp;
      if (ageMs > GAME_CENTER_MAX_AGE_SECONDS * 1000 || ageMs < -60_000) {
        throw invalid("timestamp");
      }
      const url = trustedCertUrl(proof.publicKeyUrl);
      if (!url) {
        throw invalid("certificate url");
      }
      const cert = await certificate(url, now);
      if (!validAt(cert, now)) {
        throw invalid("certificate expired");
      }
      const timestamp = Buffer.alloc(8);
      timestamp.writeBigUInt64BE(BigInt(proof.timestamp));
      const payload = Buffer.concat([
        Buffer.from(proof.playerId, "utf8"),
        Buffer.from(proof.bundleId, "utf8"),
        timestamp,
        Buffer.from(proof.salt, "base64"),
      ]);
      let ok = false;
      try {
        ok = verify(
          "RSA-SHA256",
          payload,
          cert.publicKey,
          Buffer.from(proof.signature, "base64")
        );
      } catch {
        ok = false;
      }
      if (!ok) {
        throw invalid("signature");
      }
      return { provider: "game_center", providerUserId: proof.playerId };
    },
    /** Number of cached certificates (tests). */
    cacheSize: () => certs.size,
  };
}
export type GameCenterVerifier = ReturnType<typeof createGameCenterVerifier>;
