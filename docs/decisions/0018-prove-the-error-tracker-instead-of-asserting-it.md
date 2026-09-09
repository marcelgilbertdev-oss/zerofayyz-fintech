# 18. Prove the error tracker instead of asserting it

Date: 2026-09-09

## Status

Accepted. Verified against the live Render deployment on 2026-09-09.

## Context

The Sentry project for this API had received no events since error tracking was
added on 2026-08-23, showing the "Waiting for events" onboarding state. The
obvious reading was that the integration was broken.

It was not. `SENTRY_DSN` is set on Render, `initialiseErrorTracking()` runs at
app-build time before any request is served, and the `onError` hook reports with
the request id attached. The project was empty for a duller reason: this API
does not throw. Every failure path returns `reply.code(4xx).send(...)`, which is
a response, not an error, and Fastify's `onError` fires only on an actual
unhandled exception. Nothing had crashed, so there was nothing to report.

That is the good outcome, and it exposed the real defect: **an empty Sentry
project and a silently misdirected one are indistinguishable.** Worse,
`/health` actively encouraged the wrong reading of the ambiguity, because
`errorTrackingStatus()` was implemented as:

```ts
return process.env.SENTRY_DSN?.trim() ? "configured" : "unconfigured";
```

An environment variable proves somebody set a string. It does not prove that
events reach Sentry. That check would report `configured` for a typo'd key, a
revoked key, or a DSN pointing at a deleted project — and because it is a health
endpoint, it would be believed. A monitoring system that fails silently while
reporting itself healthy is worse than no monitoring, because it converts an
absence of alerts into false confidence.

## Decision

Three changes, all small.

**1. `/health` reports initialisation, not configuration.**
`errorTrackingStatus()` now returns the module's `initialised` flag. The endpoint
can no longer claim more than the process achieved.

**2. `Sentry.init` is wrapped, and a failure is survivable.**
A malformed DSN throws. Boot must not depend on a third-party endpoint being
typed correctly: the failure is logged, the tracker stays off, `/health` says
`unconfigured`, and the API serves traffic. It is more useful up and untracked
than down and observable.

**3. Every boot emits one event.**
`Sentry.captureMessage("api.startup", "info")` fires immediately after a
successful init. Each deploy therefore demonstrates the whole path — DSN, network,
project routing — end to end. One info-level event per deploy is negligible
against the free tier's quota, and it converts "we have seen no errors" from an
assumption into evidence.

## Consequences

The Sentry project is no longer empty, so its emptiness stops being a signal that
has to be interpreted. If startup events stop arriving, the pipeline is broken;
if they arrive and errors do not, the API genuinely is not throwing. Those two
states were previously the same picture.

`/health` becomes trustworthy on this field, which matters more than it sounds:
it is the field a reviewer is most likely to take at face value.

The cost is one event per deploy and a startup log line on misconfiguration.

## Alternatives considered

**Leave it.** The integration worked. But "it works, trust me" is exactly the
claim this platform exists to avoid making.

**A guarded endpoint that throws a test error.** Real proof, but an
error-injection route on a payments API is a liability that has to be
authenticated, rate-limited and remembered. The startup event proves the same
path with nothing to secure.

**Health-check Sentry's ingest at boot.** Adds a network dependency to startup
and a new failure mode, to learn what a captured event already tells us.
