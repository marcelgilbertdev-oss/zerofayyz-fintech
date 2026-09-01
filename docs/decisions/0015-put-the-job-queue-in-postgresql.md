# 15. Put the job queue in PostgreSQL

Date: 2026-09-01

## Status

Accepted.

## Context

The platform had scheduled work but no reliable background work. The hourly
monitor runs *outside* the platform (GitHub Actions), and the one piece of
in-process coordination — claiming a refund request atomically — solved a
narrow case without generalising. Three questions had no shipped answer: how
does deferred work survive a restart, how do two instances avoid running the
same job twice, and what happens to work that keeps failing?

The conventional answers are Redis (BullMQ) or a hosted queue (SQS). Both are
real infrastructure with real merits, and both were rejected here.

## Decision

A `jobs` table in the same PostgreSQL database that holds the ledger, with a
small TypeScript module over it and an in-process worker loop.

- **Claiming is one atomic UPDATE** over `FOR UPDATE SKIP LOCKED`: two workers
  waking together cannot take the same row, and losers skip past rather than
  queueing behind the winner. The refund-approval claim, generalised.
- **A lease, not a lock.** A claim is honoured for five minutes; a worker that
  dies holding a job simply stops renewing its existence, and the next claim
  reclaims the row. Restart-survival and crash-recovery are the same mechanism.
- **Retry is a schedule change.** A failed job returns to `pending` with
  `run_at` pushed out by capped exponential backoff — a retried job and a
  delayed job are one concept, not two.
- **Dead, not deleted.** A job that exhausts `max_attempts` becomes `dead` and
  keeps its last error. A queue that deletes what it cannot process destroys
  the evidence needed to find out why.
- **Enqueue-side idempotency** by UNIQUE key, `ON CONFLICT DO NOTHING` — the
  webhook-event-id trick applied to job creation. Recurring work builds on it:
  each run enqueues the next with a time-bucketed key, so any number of
  instances seeding "next hour" converge on one row, with no cron and nothing
  held in memory.
- **Workers claim only kinds they handle.** The first test run found the flaw:
  a worker with no handler for a kind claimed the job anyway and burned its
  attempts — a deployment gap silently became a dead job. The claim now
  filters by the worker's handler list; the cost is that an unhandled kind
  waits forever, so the admin surface (`/admin/jobs`) exposes queue depth by
  kind and status, making the orphan visible rather than lost.

Why Postgres: the work and the ledger it touches can commit or roll back
together. A queue in another system cannot join a transaction with the rows it
is about to change, so "job done" and "money moved" can disagree — which is
the exact class of inconsistency this platform exists to refuse. Second-order
reasons: one fewer credential and failure domain on free-tier hosting, and the
same test harness the ledger already uses.

## The guarantee, stated honestly

**At-least-once, not exactly-once.** A worker can finish the work, die before
writing `succeeded`, and have its lease reclaimed — a slow worker and a dead
one are indistinguishable from the queue's side. Exactly-once delivery over a
channel that can fail between the work and the acknowledgement does not exist,
and claiming it would be the same mistake as trusting a webhook's delivery
count. Handlers must therefore be safe to run twice; the first consumer
(session-retention cleanup) is idempotent by nature, and anything touching
money must use the same constraint-based idempotency the webhook path uses.

## Consequences

Twenty-one integration tests prove the concurrency and crash properties
against real PostgreSQL — racing claims, lease reclaim, a live lease left
alone, backoff, dead-lettering, convergent seeding — none of which a stubbed
database can show. The worker runs in-process (`JOB_WORKER=off` disables it
for operational headroom), polls rather than LISTEN/NOTIFY on the view that a
mechanism whose failure mode is "slightly late" beats one whose failure mode
is "never", and backs off to one query per 30 seconds when idle, which matters
on a database billed by compute time.

Known limits, carried knowingly: the poll interval bounds latency at ~30s idle
(fine for minutes-scale work, wrong for user-facing async); the lease is not
extended mid-job, so handlers must stay far under five minutes; and the
webhook path still does its work synchronously — moving it onto the queue is
now *possible* and remains deliberately undone, because the payment path is
live and the queue should earn trust on lower-stakes work first.
