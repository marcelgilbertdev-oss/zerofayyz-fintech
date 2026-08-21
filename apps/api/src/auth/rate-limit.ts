/**
 * A fixed-window limiter for failed login attempts, held in memory.
 *
 * It counts FAILURES only. A successful sign-in neither consumes budget nor
 * accumulates toward a lockout, because the thing being rate-limited is
 * guessing, and a correct password is not a guess.
 *
 * That distinction is not academic here. The demo operator account is public
 * and shared by every reviewer who visits, so it is the one account guaranteed
 * to see bursts of simultaneous *successful* logins. Counting those would mean
 * the sixth recruiter in a busy fifteen minutes is turned away from a demo
 * built to impress them — and the lockout would look identical to a broken
 * platform. This project's own parallel test suite tripped exactly that.
 *
 * In memory because this API runs as a single instance and an external store
 * would be a dependency bought for a problem it does not have yet. It is
 * documented as per-instance on purpose: a limiter that silently stops working
 * when a second instance appears is worse than no limiter, because everyone
 * assumes it is still there.
 */
export type RateLimitStatus = {
  blocked: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export class FixedWindowRateLimit {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Read-only: does this key currently owe a wait? Consumes nothing. */
  status(key: string, now = Date.now()): RateLimitStatus {
    this.evictExpired(now);

    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      return { blocked: false, remaining: this.limit, retryAfterSeconds: 0 };
    }

    const remaining = Math.max(0, this.limit - entry.count);

    return {
      blocked: remaining === 0,
      remaining,
      retryAfterSeconds: remaining === 0
        ? Math.ceil((entry.resetAt - now) / 1000)
        : 0,
    };
  }

  /** Called only when an attempt was wrong. */
  recordFailure(key: string, now = Date.now()): RateLimitStatus {
    this.evictExpired(now);

    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }

    return this.status(key, now);
  }

  /** Called on success, so a legitimate sign-in clears the slate. */
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
