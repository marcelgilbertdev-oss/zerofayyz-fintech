# 22. Recurring work runs as rarely as its retention allows

Date: 2026-09-17

## Status

Accepted. Shipped the same day as ADR 21; the effect is measured on the Neon
dashboard over the rest of September, and the projection below says what
"worked" will look like.

## Context

ADR 20 cut the database's burn from about 6.7 compute-hours a day to about
one. It was not enough. Read from the Neon console on the morning of the
17th: **88.52 of 100 CU-hours used since 1 September**, against 85.36 on the
14th — 0.97 a day. Thirteen and a half days remained in the month at that
rate: a projected 101.6, with the compute suspended around the 29th and the
whole platform offline until 1 October.

Where the remaining hour a day was going, from the schedules in the repo:

| Waker | Cadence | Wakes / day | CU-h / day (≈0.021 per wake) |
|---|---|---|---|
| `sessions.cleanup` chain | hourly | 24 | **≈ 0.50** |
| Worker safety poll | hourly cap | (coincides with the above) | — |
| `production-watch.yml` | cron hourly; GitHub fires every 3–5 h | ≈ 6 | ≈ 0.15 |
| `load-test.yml` | daily | 1 | ≈ 0.03 |
| Real visitors, checks | — | variable | ≈ 0.1–0.3 |

The cleanup job deletes session rows that have been expired or revoked for
**thirty days**. Running a thirty-day delete every hour changes nothing about
what gets deleted; it only decides how often the database is woken to find
out. Half the daily burn was that.

## Decision

**A recurring job runs as rarely as its own retention allows, and the
worker's safety cap is set so that the cap is never the thing doing the
waking.**

- The cleanup chain is keyed by **UTC day**, not hour: `dayBucket`,
  `nextDay`, one run at 00:00:30 UTC. Same idempotent, self-chaining,
  restart-safe pattern from ADR 15; only the bucket width changed.
- The worker's default idle cap moves from one hour to **six**. ADR 20 chose an
  hour on the reasoning that the hourly cleanup woke the database anyway; with
  the cleanup daily, an hourly cap would have become the waker. Six hours keeps
  the one case the cap exists for — a job inserted by something other than this
  process, which nothing does — bounded in hours rather than a day.
- `production-watch.yml` is **left alone**. It is a fifth of the cleanup's cost,
  it is the thing that catches a broken deploy, and the public documents and
  the résumé describe it as hourly; changing that claim is a separate
  decision, not a side effect of this one.

## Consequences

Expected burn: one cleanup wake, three safety-poll wakes, the watch, the load
test and real traffic — roughly **0.25 to 0.35 CU-hours a day**. From 88.52
on the 17th that lands near **92 to 93** on the 30th, inside the allowance
with a few hours to spare. That is a projection; the console is the measure.

The migration is self-healing. Production holds one pending hourly-keyed row
from the old code. It runs at its hour, and its handler then schedules under
the new daily key — the same key the new boot already seeded, so the UNIQUE
index keeps one row and the chain converges on daily after one more run.
Nothing is deleted, nothing is left behind.

What was given up: a session row now lingers up to twenty-three hours past
its thirty-day retention instead of up to fifty-nine minutes. On a table that
only the platform reads, that is not a cost anyone can observe.

The general rule joins ADR 20's. That one said a probe must not cost what the
provider bills. This one says the *cadence* of recurring work is a cost
decision too, and the honest floor for it is the work's own retention — not
the interval that was convenient when the database was always awake.
