import {
  createPrivateKey,
  createPublicKey,
  type JsonWebKey,
  sign,
  verify,
} from "node:crypto";

/**
 * The few JWT operations the player logins need (KF5), with node:crypto instead of a JWT
 * library: read a token, verify an RS256 signature against a JWK (Apple identity tokens) and sign
 * an ES256 token (Apple client secret). Claims are checked by the callers.
 */

export interface DecodedJwt {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signature: Buffer;
  /** `<header>.<payload>` as sent, the signed bytes. */
  signingInput: string;
}

const PARTS = 3;

function parseJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8")
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Splits and parses a compact JWS; null if it is not one. Does not verify anything. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== PARTS) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = parseJson(headerPart);
  const payload = parseJson(payloadPart);
  if (!(header && payload)) {
    return null;
  }
  return {
    header: header as DecodedJwt["header"],
    payload,
    signature: Buffer.from(signaturePart, "base64url"),
    signingInput: `${headerPart}.${payloadPart}`,
  };
}

/** Whether the RS256 signature of `jwt` matches the RSA public key `jwk`. */
export function verifyRs256(jwt: DecodedJwt, jwk: JsonWebKey): boolean {
  if (jwt.header.alg !== "RS256") {
    return false;
  }
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return verify(
      "RSA-SHA256",
      Buffer.from(jwt.signingInput),
      key,
      jwt.signature
    );
  } catch {
    return false;
  }
}

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Signs `payload` as an ES256 JWT with the PEM private key (P-256), header `kid`. */
export function signEs256(
  payload: Record<string, unknown>,
  options: { kid: string; privateKeyPem: string }
): string {
  const signingInput = `${encode({ alg: "ES256", kid: options.kid })}.${encode(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(options.privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Standard claim checks: `iss` one of `issuers`, `aud` (string or array) contains one of
 * `audiences`, `exp` in the future and `iat` not in the future (both with `leewaySeconds`).
 */
export function hasValidClaims(
  payload: Record<string, unknown>,
  expected: {
    issuers: readonly string[];
    audiences: readonly string[];
    nowSeconds: number;
    leewaySeconds?: number;
  }
): boolean {
  const leeway = expected.leewaySeconds ?? 60;
  const { iss, aud, exp, iat } = payload;
  if (typeof iss !== "string" || !expected.issuers.includes(iss)) {
    return false;
  }
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.some((a) => expected.audiences.includes(a as string))) {
    return false;
  }
  if (typeof exp !== "number" || exp + leeway < expected.nowSeconds) {
    return false;
  }
  return !(typeof iat === "number" && iat - leeway > expected.nowSeconds);
}
