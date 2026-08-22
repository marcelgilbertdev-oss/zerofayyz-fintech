# Ledger reconciler

An independent second opinion on the payments ledger.

```bash
DATABASE_URL="postgresql://..." go run ./cmd/reconcile
```

Prints a JSON report and exits `1` if the `payments` table and the
`transactions` event log disagree about any payment.

## Why it exists

The platform keeps two records of every payment. `payments` holds where a
payment stands *now*; `transactions` is an append-only log of everything that
happened and when it was learned. The log is the record of truth — it is the
one a database trigger protects from being edited. If current state ever
contradicts it, the ledger is wrong and nobody is being told.

## Why it is written in Go

Not to have Go in the repository. A reconciler written inside the API would
share the API's model of what a refund means, its query builder, and its
assumptions — so it would agree with the API's bugs. This one is a separate
process, in a different language, reading the database directly, with its own
independent implementation of the rules. It is able to *disagree*, and that
capacity is the entire value. A checker that shares code with the thing it
checks is not checking anything.

## What it will not do

It reads. It never writes. A reconciler that could "fix" what it found could
also destroy the evidence of the defect it exists to surface — the discrepancy
is the finding, and a human decides what happens next.

## The case that makes it non-trivial

A `payment_refunded` event is written for *partial* refunds too. So "a refund
event exists, therefore this payment is refunded" is wrong: it flags every
partially refunded payment, and a report with false positives is a report
people stop opening. A payment is `refunded` only once the refunded amounts
reach what was captured — and refunding **more** than was captured, or
refunding a payment that never settled, are refused outright rather than
rounded away.

Events are sorted by `occurred_at` before deriving, because the log is ordered
by when things were *learned* and webhook deliveries arrive out of sequence.
Trusting row order would derive the wrong status and report a false
discrepancy on a perfectly good payment.

An unrecognised event type is an error, not a shrug: a new lifecycle state
added to the schema must break this program loudly rather than pass unchecked
forever.

## Verified

- Unit tests cover out-of-order delivery, partial and accumulating refunds,
  over-refunds, refunds of unsettled payments, empty logs, and unknown event
  types.
- Run against the real seeded database: 5 payments, 6 events, clean.
- **Proven to catch what it is for**: flipping one payment's status to `failed`
  directly in SQL produced

  ```json
  {
    "paymentId": "bbbbbbbb-0000-4000-8000-000000000001",
    "storedStatus": "failed",
    "derivedStatus": "succeeded",
    "reason": "stored status is not what the event log implies"
  }
  ```

  and exit code 1. Restoring the row returned a clean report.
- CI vets, tests, and runs it against a freshly seeded ledger on every push.
