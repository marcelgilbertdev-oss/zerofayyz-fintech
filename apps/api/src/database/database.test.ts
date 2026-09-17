import assert from "node:assert/strict";
import test from "node:test";

import { connectWithWake, isColdStartError } from "./database.js";

/**
 * The cold path cannot be reached in CI: every job there points at a local
 * Postgres that is always warm, so a connection never has to wait for a
 * compute to resume. That is precisely how a 1500ms connection timeout
 * survived twenty decision records and reached production — see ADR 21.
 * These tests stand in for the sleeping database.
 */

const coldStartMessages = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
];

test("the errors a waking compute produces are recognised", () => {
  for (const message of coldStartMessages) {
    assert.equal(
      isColdStartError(new Error(message)),
      true,
      `not treated as a cold start: ${message}`,
    );
  }

  for (const code of ["ETIMEDOUT", "ECONNRESET", "EPIPE"]) {
    const error: NodeJS.ErrnoException = new Error("socket failure");
    error.code = code;
    assert.equal(isColdStartError(error), true, `not recognised: ${code}`);
  }
});

test("a query that failed after connecting is not a cold start", () => {
  // The safety argument for retrying is that the statement never reached the
  // database. A constraint violation proves it did, so it must not qualify —
  // retrying one of these could repeat a write to the ledger.
  const violation: NodeJS.ErrnoException = new Error(
    'duplicate key value violates unique constraint "payments_pkey"',
  );
  violation.code = "23505";

  assert.equal(isColdStartError(violation), false);
  assert.equal(isColdStartError(new Error("syntax error at or near")), false);
  assert.equal(isColdStartError("Connection terminated unexpectedly"), false);
  assert.equal(isColdStartError(undefined), false);
});

test("a connection that fails while the compute wakes is retried", async () => {
  let attempts = 0;

  const connected = await connectWithWake(
    async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new Error("Connection terminated unexpectedly");
      }

      return "client";
    },
    2,
    0,
  );

  assert.equal(connected, "client");
  assert.equal(attempts, 2, "the second attempt never happened");
});

test("a retry is spent once, not forever", async () => {
  let attempts = 0;

  await assert.rejects(
    connectWithWake(
      async () => {
        attempts += 1;
        throw new Error("timeout exceeded when trying to connect");
      },
      2,
      0,
    ),
    /timeout exceeded when trying to connect/,
  );

  // A database that is genuinely unreachable must surface quickly rather than
  // holding the request open through an unbounded sequence of attempts.
  assert.equal(attempts, 2);
});

test("a failure that is not a cold start is raised on the first attempt", async () => {
  let attempts = 0;

  await assert.rejects(
    connectWithWake(
      async () => {
        attempts += 1;
        throw new Error("password authentication failed for user");
      },
      2,
      0,
    ),
    /password authentication failed/,
  );

  // Retrying a rejected password neither fixes it nor is free: it doubles the
  // failed-login trail for something that was answered the first time.
  assert.equal(attempts, 1);
});
