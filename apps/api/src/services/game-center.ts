import { verify, X509Certificate } from "node:crypto";
import type { GameCenterAuthRequest } from "@soulwick/contracts";
import { ApiError, withCause } from "../lib/errors.ts";
import type { BaseDeps } from "../types.ts";
import type { VerifiedLogin } from "./logins.ts";

/**
 * Game Center sign-in of the iOS app (KONZEPT_ONLINE.md §3.4, KF5). GameKit's
 * `fetchItems(forIdentityVerificationSignature:)` gives a certificate URL on an Apple host, a
 * signature, a salt and a timestamp; the server loads the certificate (over HTTPS from apple.com,
 * cached), checks the bundle id against GAME_CENTER_BUNDLE_IDS, the age of the timestamp and the
 * RSA-SHA256 signature over teamPlayerID + bundle id + timestamp (uint64 big endian) + salt.
 */

/** TESTWERT: how old the signature's timestamp may be. */
export const GAME_CENTER_MAX_AGE_SECONDS = 600;
/** TESTWERT: certificates are cached this long per URL. */
const CERT_CACHE_MS = 24 * 3_600_000;
const APPLE_HOST = /(^|\.)apple\.com$/;

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

/** The certificate URL must be HTTPS on an apple.com host (Apple's guidance). */
function trustedCertUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && APPLE_HOST.test(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

type GameCenterProof = Omit<GameCenterAuthRequest, "name" | "appearance">;

/** Game Center check with a certificate cache per app instance. */
export function createGameCenterVerifier(
  deps: Pick<BaseDeps, "fetch" | "config">
) {
  const certs = new Map<string, { cert: X509Certificate; at: number }>();

  async function certificate(url: URL): Promise<X509Certificate> {
    const cached = certs.get(url.href);
    if (cached && Date.now() - cached.at < CERT_CACHE_MS) {
      return cached.cert;
    }
    const doFetch = deps.fetch ?? fetch;
    let cert: X509Certificate;
    try {
      const res = await doFetch(url, {
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
    certs.set(url.href, { cert, at: Date.now() });
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
      const cert = await certificate(url);
      const validFrom = Date.parse(cert.validFrom);
      const validTo = Date.parse(cert.validTo);
      if (now.getTime() < validFrom || now.getTime() > validTo) {
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
  };
}
export type GameCenterVerifier = ReturnType<typeof createGameCenterVerifier>;
