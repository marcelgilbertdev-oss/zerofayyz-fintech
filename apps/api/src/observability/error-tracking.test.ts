import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  errorTrackingStatus,
  initialiseErrorTracking,
  reportError,
  resetErrorTrackingForTests,
  scrubEventForTests,
} from "./error-tracking.js";

/**
 * The branch that matters most here is the one where nothing is configured:
 * the platform must behave identically without a DSN, because that is how it
 * runs in every test, every CI job, and any deployment that has not been given
 * one. An observability integration that becomes a hard dependency has made
 * the system less reliable, not more.
 */

const originalDsn = process.env.SENTRY_DSN;

afterEach(() => {
  if (originalDsn === undefined) {
    delete process.env.SENTRY_DSN;
  } else {
    process.env.SENTRY_DSN = originalDsn;
  }
  resetErrorTrackingForTests();
});

describe("error tracking", () => {
  it("stays inert with no DSN, and says so", () => {
    delete process.env.SENTRY_DSN;

    assert.equal(initialiseErrorTracking(), "unconfigured");
    assert.equal(errorTrackingStatus(), "unconfigured");
  });

  it("reporting an error without a DSN is a no-op, not a throw", () => {
    delete process.env.SENTRY_DSN;
    initialiseErrorTracking();

    // If this throws, an error in a route becomes two errors in production.
    assert.doesNotThrow(() => reportError(new Error("boom"), { requestId: "abc" }));
  });

  it("treats a whitespace-only DSN as absent", () => {
    process.env.SENTRY_DSN = "   ";

    assert.equal(initialiseErrorTracking(), "unconfigured");
    assert.equal(errorTrackingStatus(), "unconfigured");
  });

  it("scrubs every credential-bearing header before an event leaves the process", () => {
    // This is a payments API. A cookie is a session, and stripe-signature is a
    // shared secret; an error report carrying either turns an incident
    // dashboard into a credential store.
    const scrubbed = scrubEventForTests({
      request: {
        headers: {
          cookie: "zf_session=super-secret-token",
          authorization: "Bearer abc123",
          "stripe-signature": "t=1,v1=deadbeef",
          "set-cookie": "zf_session=another",
          "user-agent": "probe/1.0",
        },
      },
    });

    assert.deepEqual(Object.keys(scrubbed.request?.headers ?? {}), ["user-agent"]);
  });

  it("strips the query string entirely rather than allowlisting it", () => {
    // Pagination is harmless; a Stripe return carries a checkout session id.
    // An allowlist here would drift, so the whole query goes.
    const scrubbed = scrubEventForTests({
      request: { query_string: "checkout=success&session_id=cs_test_secret" },
    });

    assert.equal(scrubbed.request?.query_string, undefined);
  });
});
