-- 008: A durable job queue, in the database that already holds the ledger.
--
-- The platform had scheduled work — the hourly production monitor — but no way
-- to run background work *reliably*: nothing that survives a process dying
-- mid-job, retries with backoff, or refuses to run the same job twice when two
-- workers wake at the same moment. The refund route already solved a narrow
-- version of this with an atomic claim; this generalises it.
--
-- Postgres rather than Redis or SQS, for the same reason the idempotency
-- guarantee lives in a UNIQUE index: the work and the ledger it touches can
-- then commit or roll back together. A queue in another system cannot join a
-- transaction with the rows it is about to change, so "job done" and "money
-- moved" can disagree. Here they cannot.
--
-- THE GUARANTEE, STATED HONESTLY: at-least-once, not exactly-once.
--
-- Exactly-once delivery does not exist over a channel that can fail after the
-- work and before the acknowledgement. A worker can complete a job, lose power,
-- and have its lease reclaimed by another worker — from the queue's side those
-- are indistinguishable. So the queue promises that every job runs at least
-- once, and gives handlers what they need to make a second run harmless: a
-- stable idempotency key, and a transaction they can do their own work inside.
-- Claiming otherwise would be the same mistake as trusting a webhook's
-- delivery count.

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Enqueue-side idempotency. A caller that retries an enqueue — because it
  -- did not see the first response — supplies the same key and gets the same
  -- job rather than a second one. Same mechanism as the webhook event id:
  -- refused by an index, not by application branching.
  idempotency_key TEXT UNIQUE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),

  -- When this job becomes eligible. Backoff is expressed by pushing this
  -- forward, so a delayed job and a retried job are the same mechanism.
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),

  -- The lease. A worker that dies holds claimed_at forever; the reclaim query
  -- treats a lease older than the timeout as abandoned. This is what makes the
  -- queue survive a restart — and also why the guarantee is at-least-once: a
  -- slow worker and a dead one look identical from here.
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,

  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A terminal job holds no lease; a running one must. Cheap invariant that
  -- catches a whole class of bug where a worker forgets to release.
  CONSTRAINT jobs_running_holds_lease CHECK (
    (status = 'running' AND claimed_at IS NOT NULL)
    OR (status <> 'running' AND claimed_at IS NULL)
  )
);

-- The claim query's index: pending work, oldest due first. Partial, because
-- succeeded jobs accumulate and must not slow the hot path.
CREATE INDEX IF NOT EXISTS jobs_claimable_idx
  ON jobs (run_at)
  WHERE status = 'pending';

-- The reclaim query's index: leases that may have expired.
CREATE INDEX IF NOT EXISTS jobs_lease_idx
  ON jobs (claimed_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS jobs_kind_status_idx ON jobs (kind, status);

-- The request lane (migration 007) has no business reading operational
-- plumbing, so it gets no grant here. Default-deny for new tables, as ADR 14
-- said it would be.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
