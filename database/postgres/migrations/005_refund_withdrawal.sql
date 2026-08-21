-- A requester may withdraw their own pending request.
--
-- Found by the end-to-end suite, which is a story worth keeping: an
-- administrator raised a refund request, the four-eyes rule correctly barred
-- them from deciding it, and no second administrator existed yet — so the
-- request sat pending forever, blocking the one-pending-per-payment slot for
-- everyone. A rule that only adds a second pair of eyes must not remove the
-- first pair's ability to change their mind about their own ask.

ALTER TABLE refund_requests DROP CONSTRAINT IF EXISTS refund_requests_status_check;
ALTER TABLE refund_requests ADD CONSTRAINT refund_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));

-- Withdrawal is the one decision the requester makes about their own request,
-- so the not-your-own rule inverts for it: approved/rejected must be decided
-- by someone else; withdrawn must be decided by the requester themselves.
ALTER TABLE refund_requests DROP CONSTRAINT IF EXISTS refund_decider_is_not_requester;
ALTER TABLE refund_requests ADD CONSTRAINT refund_decider_is_not_requester
  CHECK (
    decided_by IS NULL
    OR (status = 'withdrawn' AND decided_by = requested_by)
    OR (status <> 'withdrawn' AND decided_by <> requested_by)
  );
