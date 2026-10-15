/** Burst allowance: a bucket holds this many seconds' worth of its rate. */
const BURST_SECONDS = 2;

/** Continuous token bucket; `now` in milliseconds. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perMs: number;

  constructor(ratePerSecond: number, now: number) {
    this.capacity = ratePerSecond * BURST_SECONDS;
    this.perMs = ratePerSecond / 1000;
    this.tokens = this.capacity;
    this.last = now;
  }

  take(amount: number, now: number): boolean {
    const elapsed = Math.max(0, now - this.last);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perMs);
    this.last = now;
    if (this.tokens < amount) {
      return false;
    }
    this.tokens -= amount;
    return true;
  }
}

/** Messages per second and bytes per second of one connection. */
export class ConnectionLimiter {
  private readonly messages: TokenBucket;
  private readonly bytes: TokenBucket;

  constructor(
    limits: { messagesPerSecond: number; bytesPerSecond: number },
    now: number
  ) {
    this.messages = new TokenBucket(limits.messagesPerSecond, now);
    this.bytes = new TokenBucket(limits.bytesPerSecond, now);
  }

  /** False = over the limit; the message must be dropped. */
  allow(byteLength: number, now: number): boolean {
    // A message rejected for its size still costs its message token.
    return this.messages.take(1, now) && this.bytes.take(byteLength, now);
  }
}

/** Fixed one-minute window per client IP for new connections (like the API's rate limit). */
export class IpConnectionLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private lastSweep = 0;
  private readonly limit: number;

  constructor(perMinute: number) {
    this.limit = perMinute;
  }

  allow(ip: string, now: number): boolean {
    if (now - this.lastSweep > 60_000) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) {
          this.buckets.delete(key);
        }
      }
      this.lastSweep = now;
    }
    let bucket = this.buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      this.buckets.set(ip, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }
}
