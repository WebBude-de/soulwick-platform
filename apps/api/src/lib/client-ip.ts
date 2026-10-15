import { getConnInfo } from "@hono/bun";
import type { Context } from "hono";

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
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
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // app.request() in tests has no Bun server behind it.
    return "unknown";
  }
}
