import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";

/**
 * The visitor's address for the API's per-IP limits. The website calls the API from its own
 * server, so it passes the address on as `X-Forwarded-For`; the API believes that header only
 * from trusted peers (`TRUSTED_PROXY_CIDRS`), i.e. from this website inside the Docker network.
 * So the website must not believe headers a visitor can set himself (KF5 security review):
 * - `CF-Connecting-IP` only with `TRUST_CLOUDFLARE` (the domain runs through the Cloudflare
 *   proxy, orange cloud). Without a firewall that only lets Cloudflare reach port 443 a visitor
 *   could still set it himself (`infra/DOKPLOY.md` §2).
 * - `X-Forwarded-For`: every proxy appends the address of whoever connected to it. With
 *   `TRUSTED_PROXY_HOPS` proxies in front of the website (default 1, Traefik), the entry at that
 *   position from the right is what the outermost of them saw, the visitor; everything further
 *   left came from the visitor and can be forged.
 * - Nothing usable: no header, the API then counts the website itself.
 */
export function clientIpFrom(
  get: (name: string) => string | null,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (isOn(env.TRUST_CLOUDFLARE)) {
    const cloudflare = get("cf-connecting-ip")?.trim();
    if (cloudflare && isIP(cloudflare)) {
      return cloudflare;
    }
  }
  const hops = proxyHops(env.TRUSTED_PROXY_HOPS);
  const chain = (get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (hops > 0 && chain.length >= hops) {
    const candidate = chain.at(-hops);
    if (candidate && isIP(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Headers for an API call made on behalf of the current visitor. */
export async function forwardedFor(): Promise<Record<string, string>> {
  const incoming = await headers();
  const ip = clientIpFrom((name) => incoming.get(name));
  return ip ? { "x-forwarded-for": ip } : {};
}

function isOn(value: string | undefined): boolean {
  return ["true", "1", "on", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

/** Proxies in front of the website that append to `X-Forwarded-For`; default 1 (Traefik). */
function proxyHops(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 1;
}
