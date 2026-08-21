import assert from "node:assert/strict";
import test from "node:test";

import { FixedWindowRateLimit } from "./rate-limit.js";

test("failures accumulate and the account closes on the limit", () => {
  const limiter = new FixedWindowRateLimit(3, 60_000);

  assert.equal(limiter.status("a", 0).blocked, false);
  limiter.recordFailure("a", 0);
  limiter.recordFailure("a", 1);
  assert.equal(limiter.status("a", 2).blocked, false);

  limiter.recordFailure("a", 2);
  const blocked = limiter.status("a", 3);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.retryAfterSeconds, 60);
});

test("checking status never consumes budget", () => {
  const limiter = new FixedWindowRateLimit(2, 60_000);

  for (let i = 0; i < 50; i += 1) {
    limiter.status("a", i);
  }

  // Fifty checks and the account is untouched: reading whether someone is
  // locked out must not be the thing that locks them out.
  assert.equal(limiter.status("a", 51).remaining, 2);
  assert.equal(limiter.status("a", 51).blocked, false);
});

test("successful sign-ins never accumulate toward a lockout", () => {
  const limiter = new FixedWindowRateLimit(5, 60_000);

  // Ten reviewers sign in correctly, one after another. Under a limiter that
  // counted every attempt, the sixth would be refused entry to a public demo
  // account — a lockout indistinguishable from a broken platform.
  for (let i = 0; i < 10; i += 1) {
    assert.equal(limiter.status("demo@zerofayyz.test", i).blocked, false);
    limiter.reset("demo@zerofayyz.test");
  }

  assert.equal(limiter.status("demo@zerofayyz.test", 11).blocked, false);
});

test("one account's failures do not lock another", () => {
  const limiter = new FixedWindowRateLimit(1, 60_000);

  limiter.recordFailure("a", 0);

  assert.equal(limiter.status("a", 0).blocked, true);
  assert.equal(limiter.status("b", 0).blocked, false);
});

test("the window reopens once it has passed", () => {
  const limiter = new FixedWindowRateLimit(1, 1_000);

  limiter.recordFailure("a", 0);
  assert.equal(limiter.status("a", 500).blocked, true);
  assert.equal(limiter.status("a", 1_001).blocked, false);
});

test("a success clears failures already recorded", () => {
  const limiter = new FixedWindowRateLimit(2, 60_000);

  limiter.recordFailure("a", 0);
  limiter.reset("a");

  // Two typos then a correct password must not leave the account one mistake
  // from a lockout for the next fifteen minutes.
  assert.equal(limiter.status("a", 1).remaining, 2);
});

test("expired entries are evicted rather than accumulating forever", () => {
  const limiter = new FixedWindowRateLimit(1, 1_000);

  for (let i = 0; i < 500; i += 1) {
    limiter.recordFailure(`caller-${i}`, i);
  }

  limiter.recordFailure("late", 100_000);

  const held = (limiter as unknown as { hits: Map<string, unknown> }).hits;
  assert.equal(held.size, 1);
});
