import assert from "node:assert/strict";
import test from "node:test";

import { FixedWindowRateLimit } from "./rate-limit.js";

test("requests are allowed up to the limit and refused after it", () => {
  const limiter = new FixedWindowRateLimit(3, 60_000);

  assert.equal(limiter.check("a", 0).allowed, true);
  assert.equal(limiter.check("a", 1).allowed, true);
  assert.equal(limiter.check("a", 2).allowed, true);

  const refused = limiter.check("a", 3);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 60);
});

test("one caller's budget is not another's", () => {
  const limiter = new FixedWindowRateLimit(1, 60_000);

  assert.equal(limiter.check("a", 0).allowed, true);
  assert.equal(limiter.check("b", 0).allowed, true);
  assert.equal(limiter.check("a", 0).allowed, false);
});

test("the window reopens once it has passed", () => {
  const limiter = new FixedWindowRateLimit(1, 1_000);

  assert.equal(limiter.check("a", 0).allowed, true);
  assert.equal(limiter.check("a", 500).allowed, false);
  assert.equal(limiter.check("a", 1_001).allowed, true);
});

test("a success clears the budget it spent", () => {
  const limiter = new FixedWindowRateLimit(2, 60_000);

  limiter.check("a", 0);
  limiter.reset("a");

  assert.equal(limiter.check("a", 1).remaining, 1);
});

test("expired entries are evicted rather than accumulating forever", () => {
  const limiter = new FixedWindowRateLimit(1, 1_000);

  for (let i = 0; i < 500; i += 1) {
    limiter.check(`caller-${i}`, i);
  }

  // Well past every window above. If eviction did not happen the map would
  // still be holding all 500 keys.
  limiter.check("late", 100_000);

  const held = (limiter as unknown as { hits: Map<string, unknown> }).hits;
  assert.equal(held.size, 1);
});
