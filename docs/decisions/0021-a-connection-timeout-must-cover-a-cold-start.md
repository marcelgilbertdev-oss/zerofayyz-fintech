# 21. A connection timeout must cover a cold start

Date: 2026-09-17

## Status

Accepted. The measurement that prompted it is in the Context; the fix ships
with unit tests that stand in for the sleeping database, because CI has no way
to reach one.

## Context

ADR 20 stopped the probes that were keeping Neon's compute awake. It worked:
on 14 September the compute showed Idle for the first time. On the morning of
17 September Sentry raised its first two error issues ever, six minutes apart,
both on the release tagged `c68e7b5` — the ADR 20 commit itself:

* `ZEROFAYYZ-FINTECH-API-2` — `GET /api/v1/metrics`
* `ZEROFAYYZ-FINTECH-API-3` — `GET /api/v1/transactions`

Both were the same failure, `Error: Connection terminated due to connection
timeout`, raised from `pg` before either route's query reached the database.

The pool was configured with `connectionTimeoutMillis: 1500`. That number was
chosen when the compute was never allowed to sleep, so opening a connection
was always cheap and 1500ms was never tested against anything else. A compute
that scales to zero has to be resumed first, and the resume is on the
connection path.

Measured against production the same morning, with the database left alone
beforehand:

| Request | Total |
|---|---|
| First request after a quiet spell | 1.99s |
| Warm, three samples | 0.28s / 0.28s / 0.28s |
| `/api/v1/live`, which touches nothing | 0.26s |

The wake costs roughly 1.7 seconds. The ceiling was 1.5. That margin is the
whole defect: the first visitor after five idle minutes lands either side of
the line depending on how fast Neon happens to resume, which is why the
symptom is two errors on a quiet morning rather than a service that is
plainly down.

Nothing in the test suite could see it. Every CI job points `DATABASE_URL` at
a local Postgres service container, which is always warm, so the cold path
never executes there — not in 85 unit tests, not in 82 integration tests, not
in the smoke suite against production, which runs often enough to find the
database already awake.

## Decision

**A timeout on a dependency that is allowed to sleep must be budgeted for
waking it, not for answering when awake.**

- `connectionTimeoutMillis` moves from 1500 to **10 seconds** — roughly six
  times the observed resume, so the figure survives a slow one instead of
  sitting next to it.
- Connection attempts are **retried once** when the failure is one a waking
  compute produces: the two timeout messages, `Connection terminated
  unexpectedly`, and the `ETIMEDOUT` / `ECONNRESET` / `EPIPE` socket codes.
  The second shape matters separately from the first — a socket closed
  mid-resume fails immediately rather than consuming the timeout, so a retry
  costs almost nothing and recovers the request.
- **The retry is on establishing the connection, never on the statement.**
  That is the entire safety argument: if the connection was never established
  the statement never reached the database, so running it again cannot repeat
  a write to the ledger. A failure after connecting — a constraint violation,
  a serialisation failure, a rejected password — is raised on the first
  attempt, and a test asserts each case.
- `checkHealth` uses the same wake-aware checkout. A sleeping database is not
  a broken one, and reporting the platform down for the seconds Neon takes to
  resume would be a false alarm on the page a reviewer is most likely to have
  open.
- `idleTimeoutMillis` **stays at 10 seconds.** Holding pooled connections open
  would avoid the wake-up and undo what ADR 20 bought. Paying a cold connect
  is the intended cost; the retry is what makes paying it invisible.

## Consequences

The first request after an idle spell takes about two seconds instead of
failing. Every subsequent request is unchanged at ~0.28s. Nothing about the
Neon allowance changes: the compute still sleeps on exactly the same schedule,
and this record adds no probe, no loop and no keep-warm.

What was given up: a database that is genuinely unreachable now takes up to
about twenty seconds to say so, where it used to take three. The failure is
rarer than the cold start by a wide margin, and a caller that waits is
recoverable where a caller that was told "timeout" is not. A wrong password
or a refused connection is still immediate, because neither is a cold-start
error.

The new tests are unit tests over the classifier and the retry loop, with the
connect function injected. They are honest about what they prove: that the
right errors are retried and the wrong ones are not. They do not prove Neon
resumes inside ten seconds — only the production measurement above does, and
only for that morning.

This is the fourth time on this platform that a thing which was configured was
mistaken for a thing which was correct — after a secret that was present but
wrong (ADR 18's predecessor), a Sentry that was configured but not
initialised (ADR 18), and a keep-alive that was refused but counted as active
(ADR 19). The shape here is **warm is not cold**: a value that was only ever
exercised against a dependency in its easy state. ADR 20 did not introduce
this defect. It removed the condition that was hiding it, which is the normal
way a latent setting becomes a live one, and is an argument for reading the
settings that a change makes newly reachable rather than only the ones it
edits.
