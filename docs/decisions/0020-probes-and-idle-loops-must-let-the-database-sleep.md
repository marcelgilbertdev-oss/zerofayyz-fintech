# 20. Probes and idle loops must let the database sleep

Date: 2026-09-13

## Status

Accepted. Shipped the same day; the effect is measured on the Neon dashboard
over the following days rather than asserted here.

## Context

The ledger lives on Neon's free plan: 100 compute-hours a month per project,
compute that scales to zero after five minutes without activity, and — per
Neon's own plan documentation — a compute that "is suspended" when the
allowance runs out. A suspended compute takes the dashboard, both SPA clients,
the API and every payment offline until the month resets.

On 2026-09-12 Neon warned the project had used 80% of its allowance. On the
13th it stood at 81.13 of 100 CU-hours: about 6.7 a day, which would have run
out on the 16th. The smallest compute size, awake around the clock, costs 6.0
CU-hours a day. The database was never sleeping, and nothing about real
traffic explained it.

Two things kept it awake, and both were polling:

1. **Render's health check.** Render sends one "every few seconds", and the
   service's `healthCheckPath` was `/api/v1/health`, which asks the database for
   its latency. A request every few seconds leaves no five-minute gap, ever.
2. **The job worker's idle loop.** After an empty poll it slept a fixed 30
   seconds and asked again. ADR 15 chose this knowingly and described it as "a
   few queries a minute, which matters on a database billed by compute time".
   It does matter — it is exactly enough to stop scale-to-zero on its own.

The scheduled canary (`keep-warm.yml`, "API liveness canary") also pinged
`/api/v1/health`, adding a smaller wake-up of its own.

## Decision

**A probe that runs often must not touch a dependency billed by the hour.**

- A new route, `GET /api/v1/live`, answers `{"live": true}` with no dependency
  at all. Render's `healthCheckPath` and the canary point at it. `/health`
  keeps its database check for the dashboard and the smoke suite, which call it
  on real visits and a few times a day. `/health` already returned 200 with the
  database down, so Render's view of the service is unchanged; only the
  database stops being woken for it.
- **The worker sleeps until there is work.** After an empty poll it asks the
  queue when the next job becomes claimable (the earliest pending `run_at`, or
  a lapsed lease) and sleeps until then, capped at one hour. An enqueue made in
  the same process wakes it at once — the API is the only thing that enqueues,
  so a magic-link email still leaves immediately rather than up to an hour
  late.
- The safety cap is an hour, not a few minutes, because each poll wakes the
  compute for at least five minutes: a fifteen-minute poll would still keep it
  awake a third of the day. The hourly session-cleanup job already wakes it
  once an hour, so an hourly cap adds nothing.

## Consequences

Expected cost: roughly one wake an hour for the cleanup chain plus the smoke
suite, the daily load test and real visitors — on the order of 1 to 1.5
CU-hours a day instead of 6.7. That is an estimate, and it is recorded as one;
the Neon dashboard over the next days is the measurement.

What was given up: a job inserted by anything other than this process (a manual
`INSERT`, a second service) now waits up to an hour instead of 30 seconds.
Nothing does that today. If something ever does, it should enqueue through the
API or use `LISTEN/NOTIFY`, which ADR 15 set aside for a reason that no longer
fully holds: the worker now needs no fixed poll to be correct, only a safety net.

ADR 15's sentence about backing off to one query per 30 seconds is superseded
by this record; ADR 15 itself is left as written.

The Kubernetes manifests still probe `/api/v1/health` for liveness. A cluster
talking to a local or always-on database does not pay per compute-hour, so they
are left alone; a cluster pointed at Neon should move its liveness probe to
`/api/v1/live` for the same reason Render did.

The general rule sits beside ADR 19's. That one said a check must measure what
the provider measures. This one says a check must not cost what the provider
bills. Both came from reading the provider's own documentation after the
provider's own warning email — which is the order to avoid next time.
