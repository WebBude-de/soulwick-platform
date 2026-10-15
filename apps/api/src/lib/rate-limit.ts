import type { Context, MiddlewareHandler } from "hono";
import { clientIp } from "./client-ip.ts";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, in-memory counter per key, for limits that count only some requests (e.g. new
 * guest accounts per IP, P-028). Same storage caveat as `rateLimit`.
 */
export function fixedWindowCounter(opts: { limit: number; windowMs: number }) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function current(key: string, now: number): Bucket | undefined {
    if (now - lastSweep > opts.windowMs) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) {
          buckets.delete(k);
        }
      }
      lastSweep = now;
    }
    const bucket = buckets.get(key);
    return bucket && bucket.resetAt > now ? bucket : undefined;
  }

  return {
    /** Seconds until `key` may count again when its window is full, else null. */
    blockedFor(key: string): number | null {
      const now = Date.now();
      const bucket = current(key, now);
      if (!bucket || bucket.count < opts.limit) {
        return null;
      }
      return Math.ceil((bucket.resetAt - now) / 1000);
    },
    /** Counts one event for `key`. */
    hit(key: string): void {
      const now = Date.now();
      const bucket = current(key, now);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      }
    },
  };
}

/**
 * Fixed-window, in-memory rate limit per client IP. Good enough for a single API container;
 * use a shared store (e.g. Redis) if the API is ever scaled to several replicas.
 */
export function rateLimit(opts: {
  limit: number;
  windowMs?: number;
  trustProxy: boolean;
  /** Separate buckets for separate limiters. */
  name?: string;
  /** Requests for which this returns true are not counted (e.g. the relay's internal calls). */
  skip?: (c: Context) => boolean;
}): MiddlewareHandler {
  const windowMs = opts.windowMs ?? 60_000;
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  return async (c, next) => {
    if (opts.skip?.(c)) {
      await next();
      return;
    }
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [key, b] of buckets) {
        if (b.resetAt <= now) {
          buckets.delete(key);
        }
      }
      lastSweep = now;
    }
    const key = clientIp(c, opts.trustProxy);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, opts.limit - bucket.count);
    c.header("RateLimit-Limit", String(opts.limit));
    c.header("RateLimit-Remaining", String(remaining));
    c.header(
      "RateLimit-Reset",
      String(Math.ceil((bucket.resetAt - now) / 1000))
    );
    if (bucket.count > opts.limit) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json(
        { error: "rate_limited", message: "Too many requests" },
        429
      );
    }
    await next();
  };
}
