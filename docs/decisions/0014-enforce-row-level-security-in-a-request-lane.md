# 14. Enforce row-level security in a request lane

Date: 2026-08-31

## Status

Accepted.

## Context

Until now, "a customer only sees their own payments" was a rule the API kept:
`requireRole` guards on routes, `WHERE user_id = $1` in SQL. Those guards are
real and tested, but they are application code. Anything that reaches the
database another way — a leaked connection string, a future service, a new
route written in a hurry — inherits none of them. The platform's own audit log
already refused to rely on convention ("we only ever insert" became a database
trigger, ADR 9); access control was the remaining place where the database
trusted the application.

There was also an inconsistency worth closing: the ledger was immutable at the
database level while row visibility was not. A reviewer who noticed one would
ask about the other.

## Decision

Migration 007 adds PostgreSQL row-level security in a **two-lane** design:

- **Service lane** — the owning role the API connects as. Webhooks, metrics
  aggregation, seeding and migrations run here, and as table owner it bypasses
  RLS. Deliberately: the public dashboard aggregates every payment, and a
  webhook has no user on whose behalf it acts. RLS is *not* `FORCE`d for this
  reason.

- **Request lane** — a `NOLOGIN` role, `zerofayyz_request`, adopted for the
  span of one transaction while serving one authenticated person, via
  `Database.queryAsUser`. It begins a transaction, sets `app.user_id` and
  `app.role` with `set_config(..., true)`, and issues `SET LOCAL ROLE`. All
  three are transaction-local by construction, so the pooled connection
  returns to service with no context attached — nothing can leak between
  requests, which is the classic hazard of RLS over a connection pool.

Policies: staff roles read the operational surface; a customer reads only rows
whose `user_id` is the transaction's context. Missing context resolves to
`NULL`, and `NULL` fails every policy — a request-lane transaction that forgot
who it serves sees nothing, not everything. The lane holds no `UPDATE` or
`DELETE` grant on any table; its single write is filing a refund request, and
a `WITH CHECK` policy refuses one filed under someone else's name.

The admin sessions read and the refund queue read now go through the lane, so
the policies are exercised on every use of the admin console, not only in
tests.

## Consequences

The claim "one user can never read another user's rows, even calling the
database directly" is now a database property with a proof: the integration
suite connects as the request role and issues SELECTs **with no per-user WHERE
clause** — rows come back absent because the policy refused them. It also
proves the failure directions: no context → zero rows; forged refund →
policy violation; UPDATE anywhere → permission denied; context gone after
COMMIT; the lane usable again after a failed query.

The honest limitation, stated rather than hidden: the service lane bypasses
RLS, so the guarantee applies to the lane that carries user requests, not to
the owner credential itself. That is the standard shape (Supabase's
`service_role` / `authenticated` split is the familiar example) and the
alternative — `FORCE` plus threading a synthetic context through webhooks,
metrics and migrations — would put the highest-risk plumbing through the
newest code for no gain a reviewer could observe.

Two operational notes. Roles are cluster-wide, so migration 007 creates the
role idempotently and grants it to `current_user` — whoever runs migrations is
the user the pool connects as, locally and on Neon. And future tables receive
no automatic grants: a new migration must decide, table by table, what the
request lane may see. Default-deny extends to schema that does not exist yet.
