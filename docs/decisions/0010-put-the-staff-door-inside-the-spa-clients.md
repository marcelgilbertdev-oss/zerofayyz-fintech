# 10. Put the staff door inside the SPA clients, on the page itself

**Status:** Accepted · **Date:** 2026-08-21

## Context

The Vue and Svelte clients existed to demonstrate that the API's public reads are
framework-independent. The platform's authentication was not part of that demonstration:
sign-in, sessions and the operator role lived only in the Next.js dashboard, which meant
the two framework clients silently implied that the interesting half of the platform was
a React feature.

Bringing authentication to them raised two questions.

**Where does the session live?** The clients are static builds on Vercel; the API runs on
Render. The browser must never talk to the API's origin directly — that posture (no API
origin in the bundle, CORS closed) was set in ADR 6. The session cookie has to survive
that arrangement.

**Where does the door go?** A separate `/login` route with a router, mirroring the
dashboard, or a panel on the single page each client already is.

## Decision

**The cookie rides the same-origin rewrite.** Each client's Vercel config already
rewrites `/api/*` to the API. A `Set-Cookie` on a rewritten response is stored by the
browser against the client's own origin (the cookie sets no `Domain` attribute, so it is
host-only), and every subsequent same-origin fetch carries it back through the rewrite
automatically. No CORS, no token in JavaScript, no third origin. The API's cookie
attributes — `HttpOnly`, `Secure`, `SameSite=Lax` — apply unchanged.

**The door is a panel, not a route.** Each client gains one **Operator area** card at the
bottom of its single page. Signed out it is the sign-in form with the published demo
credentials; signed in it is the audit trail — the one read in the system that a cookie
has to earn (`requireRole("operator")`). Adding a router to a one-view application to
host a login page would demonstrate ceremony, not capability.

**One specification, two idioms.** The behaviour is defined once — resume from
`/auth/me` on mount, refusals surfaced verbatim, a 401 from the trail flips the panel to
signed-out with a notice, sign-out clears local state even if the network call fails —
and implemented twice: a Pinia store in Vue, a runes factory in Svelte. The two test
suites assert the same contract assertion-for-assertion, so a behavioural difference
between the clients is a test failure, not a review finding.

The response shapes (`sessionUserSchema`, `loginResponseSchema`, `auditLogsSchema`) live
in the shared contract package, validated at the boundary like every other read.

## Consequences

- Each client origin holds its own session cookie, so signing in on the Vue client and
  opening the Svelte client shows the door closed there — and the Svelte audit trail
  showing the Vue sign-in as its newest row is the append-only story demonstrating
  itself across origins.
- The panel inherits the API's whole auth posture for free: per-account rate limiting,
  enumeration defence, audit entries for failures. The clients add no security logic of
  their own, which is the point — a client that invents its own security is lying about
  where enforcement lives.
- The production smoke suite gained a per-client check that `/api/v1/auth/me` answers
  a clean 401 through each rewrite — proving the login path end-to-end without spending
  a login attempt or writing audit noise.
- The `viewer` role, unused so far, stays in the shared enum: the contract fails loudly
  if the API ever returns a role the clients have never heard of.
