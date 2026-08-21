-- Phase 4: refunds with a request/approve split, and account management.

-- ---------------------------------------------------------------- users

-- A disabled account keeps its row, its history, and its audit entries; it
-- simply cannot sign in. Deleting staff would punch holes in the story the
-- audit log tells, and the log is the point.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

-- ---------------------------------------------------------------- refunds

-- A refund is money moving backwards, so it is the one action in this system
-- that gets a four-eyes rule: an operator REQUESTS, an administrator APPROVES,
-- and the schema itself refuses to let the same person do both. The audit log
-- records each half separately.
CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,

  -- NULL means "the full amount of the payment at approval time".
  amount_minor BIGINT CHECK (amount_minor IS NULL OR amount_minor > 0),
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) >= 5),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),

  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,

  -- Stripe's refund id, once the approval has actually gone out the door.
  provider_refund_id TEXT UNIQUE,

  -- The four-eyes rule, enforced where it cannot be forgotten: whoever decides
  -- a request must not be whoever raised it. The API checks this too, for a
  -- polite error message — this constraint is for every other path, including
  -- ones that do not exist yet.
  CONSTRAINT refund_decider_is_not_requester
    CHECK (decided_by IS NULL OR decided_by <> requested_by),

  -- A decided request carries its decider and timestamp; a pending one has
  -- neither. No half-decided states.
  CONSTRAINT refund_decision_is_complete
    CHECK (
      (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

-- One pending request per payment. Without this, the public demo operator
-- could queue a hundred requests against one payment and the approvals panel
-- becomes a spam feed. Partial: decided requests do not block a new one.
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_pending_per_payment
  ON refund_requests (payment_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS refund_requests_status_idx
  ON refund_requests (status, requested_at DESC);
