import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/bun";
import type { Context } from "hono";
import type { Config } from "../config.ts";

/**
 * Whom the API believes the forwarding headers (CF-Connecting-IP, X-Forwarded-For, X-Real-IP):
 * `false` = nobody (the connection's address counts), `true` = every peer (TRUST_PROXY=true
 * without TRUSTED_PROXY_CIDRS), a function = only peers whose connection address it accepts
 * (TRUSTED_PROXY_CIDRS; KF5 security fix, P-039). Without the list a client that reaches the API
 * directly can name its own IP and slip past the per-IP rate limits.
 */
export type ProxyTrust = boolean | ((remoteAddress: string) => boolean);

/**
 * Parses TRUSTED_PROXY_CIDRS entries ("10.0.0.0/8", "2400:cb00::/32", "172.17.0.5") into a
 * matcher; null when an entry is invalid.
 */
export function cidrMatcher(
  entries: readonly string[]
): ((address: string) => boolean) | null {
  const list = new BlockList();
  for (const raw of entries) {
    const [address = "", prefix] = raw.trim().split("/");
    const kind = isIP(address);
    if (kind === 0) {
      return null;
    }
    const type = kind === 4 ? "ipv4" : "ipv6";
    const max = kind === 4 ? 32 : 128;
    const bits = prefix === undefined ? max : Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > max) {
      return null;
    }
    list.addSubnet(address, bits, type);
  }
  return (address) => {
    const kind = isIP(address);
    return kind !== 0 && list.check(address, kind === 4 ? "ipv4" : "ipv6");
  };
}

const trustCache = new WeakMap<object, ProxyTrust>();

/** The proxy trust of a configuration (cached per config object). */
export function proxyTrust(
  config: Pick<Config, "TRUST_PROXY" | "TRUSTED_PROXY_CIDRS">
): ProxyTrust {
  const cached = trustCache.get(config);
  if (cached !== undefined) {
    return cached;
  }
  let trust: ProxyTrust = config.TRUST_PROXY;
  if (config.TRUST_PROXY && config.TRUSTED_PROXY_CIDRS.length > 0) {
    // config.ts validated the entries; an invalid list trusts nobody.
    trust = cidrMatcher(config.TRUSTED_PROXY_CIDRS) ?? false;
  }
  trustCache.set(config, trust);
  return trust;
}

function remoteAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // app.request() in tests has no Bun server behind it.
    return "unknown";
  }
}

export function clientIp(c: Context, trust: ProxyTrust): string {
  const remote = remoteAddress(c);
  const trusted = typeof trust === "function" ? trust(remote) : trust;
  if (trusted) {
    // Behind the Cloudflare proxy (orange cloud) the visitor's address is CF-Connecting-IP.
    const cloudflare = c.req.header("cf-connecting-ip")?.trim();
    if (cloudflare) {
      return cloudflare;
    }
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
    const real = c.req.header("x-real-ip")?.trim();
    if (real) {
      return real;
    }
  }
  return remote;
}
