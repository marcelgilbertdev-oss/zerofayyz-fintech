import * as Sentry from "@sentry/node";

/**
 * Error tracking, off by default and honest about it.
 *
 * The platform already logs structured JSON with a request id, which answers
 * "what happened to this one request". It does not answer "is this error new,
 * how often is it happening, and did the last deploy cause it" — that is what
 * an error tracker is for, and it is the difference between logs somebody
 * could read and errors somebody actually sees.
 *
 * Two deliberate choices:
 *
 * 1. **Initialised only when SENTRY_DSN is present.** A DSN is a write endpoint
 *    for your error stream. It is never in this repository, never in a default,
 *    and never in a test fixture. With no DSN the subsystem is inert and the
 *    API behaves exactly as before, so the platform is not hostage to a third
 *    party being configured.
 *
 * 2. **Scrubbing is configured here, not trusted to the SDK.** Sentry captures
 *    request context by default, and this is a payments API: cookies carry
 *    session tokens and the Stripe signature header is a shared secret. An
 *    error report that ships either turns an incident dashboard into a
 *    credential store.
 */

export type ErrorTrackingStatus = "configured" | "unconfigured";

let initialised = false;

export function initialiseErrorTracking(): ErrorTrackingStatus {
  const dsn = process.env.SENTRY_DSN?.trim();

  if (!dsn) {
    return "unconfigured";
  }

  if (initialised) {
    return "configured";
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Release tagging so "did the last deploy cause this" is answerable. Absent
    // a commit, the field is omitted rather than filled with something untrue.
    release: process.env.RENDER_GIT_COMMIT || undefined,
    // Errors, not performance traces. Tracing on a free tier burns the quota
    // errors need, and latency numbers already come from the load test.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      const headers = event.request?.headers;

      if (headers) {
        for (const header of ["cookie", "authorization", "stripe-signature", "set-cookie"]) {
          delete headers[header];
        }
      }

      // Query strings here carry pagination, but a Stripe redirect carries a
      // session id — strip the whole query rather than maintaining an allowlist
      // that will drift.
      if (event.request?.query_string) {
        delete event.request.query_string;
      }

      return event;
    },
  });

  initialised = true;
  return "configured";
}

/** What /health reports: whether the tracker is wired, never the DSN itself. */
export function errorTrackingStatus(): ErrorTrackingStatus {
  return process.env.SENTRY_DSN?.trim() ? "configured" : "unconfigured";
}

/**
 * Report an error with the request id attached, so a Sentry issue and a log
 * line can be tied together. A no-op when unconfigured.
 */
export function reportError(error: unknown, context: { requestId?: string } = {}): void {
  if (!initialised) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context.requestId) {
      scope.setTag("request_id", context.requestId);
    }
    Sentry.captureException(error);
  });
}

/** Test seam: forget initialisation so a suite can exercise both branches. */
export function resetErrorTrackingForTests(): void {
  initialised = false;
}

/** Exposed for tests: the scrubber, without needing a live Sentry client. */
export function scrubEventForTests(event: {
  request?: { headers?: Record<string, string>; query_string?: string };
}): typeof event {
  const headers = event.request?.headers;

  if (headers) {
    for (const header of ["cookie", "authorization", "stripe-signature", "set-cookie"]) {
      delete headers[header];
    }
  }

  if (event.request?.query_string) {
    delete event.request.query_string;
  }

  return event;
}
