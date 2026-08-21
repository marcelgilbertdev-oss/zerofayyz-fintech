/**
 * A fixed-window rate limiter held in memory.
 *
 * In memory because this API runs as a single instance and an external store
 * would be a dependency bought for a problem it does not have yet. The limit
 * is stated in one place so the day it moves to Redis is a change of storage,
 * not a change of rule.
 *
 * It is documented as per-instance on purpose: a limiter that silently stops
 * working when a second instance appears is worse than no limiter, because
 * everyone assumes it is still there.
 */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export class FixedWindowRateLimit {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    this.evictExpired(now);

    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    existing.count += 1;

    if (existing.count > this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
      };
    }

    return {
      allowed: true,
      remaining: this.limit - existing.count,
      retryAfterSeconds: 0,
    };
  }

  /** Called on success, so a legitimate login does not spend anyone's budget. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  // Without this the map grows for every distinct key the process ever sees,
  // which is a slow memory leak wearing the costume of a security control.
  private evictExpired(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) {
        this.hits.delete(key);
      }
    }
  }
}
