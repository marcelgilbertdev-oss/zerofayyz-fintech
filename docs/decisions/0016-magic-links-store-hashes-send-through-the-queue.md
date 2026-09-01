# 16. Magic links: store hashes, send through the queue

Date: 2026-09-01

## Status

Accepted

## Context

The dashboard needed a passwordless door — "passwordless authentication with
session revocation" is a requirement that keeps appearing in operations-portal
briefs, and the platform already had every ingredient except the link itself:
sessions with revocation, an audit log, a rate limiter, and (since ADR 15) a
durable job queue.

Two design questions dominate any magic-link implementation:

1. **What does the database store?** A row containing the raw token is a
   credential at rest — anyone with a database read (a backup, a replica, a
   compromised dashboard query) can sign in as anyone.
2. **Where does the email get sent from?** An inline send inside the request
   handler ties the user-facing 202 to a third-party SMTP call — the flakiest
   dependency in the whole system — and a failure there is invisible.

## Decision

- The `login_tokens` table stores **only a SHA-256 hash** of the token. The
  raw token exists in exactly two places, both transient: the URL in the email
  and the queue job payload that carries it to the mailer. It is never logged.
- Consumption is **one atomic UPDATE** with `used_at IS NULL` in the WHERE —
  the single-use guarantee is the row lock, so two clicks racing on one link
  produce exactly one session. Expiry (15 minutes) and the disabled-account
  check live in the same WHERE: SQL decides, not the application clock.
- The request path **always answers 202**, account or no account — the same
  anti-enumeration posture as the login route's decoy hash.
- The email leaves through the **job queue** (`auth.magic_link_email`, 5
  attempts with backoff). With no mail provider configured the job dies
  visibly on /admin/jobs instead of the request failing silently. Safe under
  at-least-once: a re-sent email carries the same single-use token.
- Requests are rate limited **per mailbox, counting every request** — unlike
  the password limiter, which counts only failures. The thing being limited
  is outbound mail, not guessing.
- The link points at the **dashboard origin**, not the API: the session cookie
  is first-party to the dashboard, so consumption travels through its proxy —
  the same shape as password login. The landing route is a GET that consumes
  and 303-redirects; the CSRF exposure of a GET-with-side-effect is accepted
  because the side effect (spending a single-use token the attacker would
  need to possess) is not exploitable cross-site.

## Consequences

- A database leak does not leak sign-in capability; hashes are useless
  without the emailed token.
- Email delivery inherits the queue's retry, backoff, and dead-letter
  visibility for free — the second consumer of ADR 15's queue, four days in.
- Until `RESEND_API_KEY` is set, requesting a link produces a visible dead
  job rather than an email; that is the designed failure mode, not a bug.
- Seven integration tests pin the properties above against real PostgreSQL,
  including the two-clicks race and the raw-token-never-stored check.
