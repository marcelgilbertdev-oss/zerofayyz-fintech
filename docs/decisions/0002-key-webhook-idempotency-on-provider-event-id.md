# 2. Key webhook idempotency on the Stripe event id

**Status:** Accepted · **Date:** 2026-08-19

## Context

Stripe delivers webhooks at least once. Retries follow any non-2xx response, and duplicates
happen even on success. A duplicated delivery must not produce a duplicated financial
record.

Three options were considered:

1. Check whether a matching transaction exists, then insert — a read followed by a write,
   which is a race under concurrent delivery
2. Track processed event ids in the application, in memory or a cache — correct only while
   one process is running and nothing restarts
3. Make the database reject the duplicate

## Decision

`transactions.provider_event_id` carries a `UNIQUE` constraint, and the insert uses
`ON CONFLICT (provider_event_id) DO NOTHING`. The payment update and audit-log write are
chained to the insert's `RETURNING` clause in the same statement, so a conflicting event
updates nothing at all.

## Consequences

Idempotency is a property of the schema rather than of application branching. It holds under
concurrent delivery, across restarts, and across however many API instances are running,
because the guarantee lives in a unique index rather than in process memory.

The whole handler becomes one statement, which is denser to read than three sequential
queries. That density is the cost, and it is why the integration suite delivers the same
event twice and asserts the row counts did not move — the property is easy to break silently
and impossible to break silently while that test exists.

Chaining also means an event for an unknown payment id writes nothing rather than creating
an orphan record, since the update finds no matching payment and the audit insert selects
from an empty set.
