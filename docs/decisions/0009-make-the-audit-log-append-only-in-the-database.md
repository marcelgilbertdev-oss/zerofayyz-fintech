# 9. Make the audit log append-only in the database

**Status:** Accepted · **Date:** 2026-08-21

## Context

An audit log's only value is that it can be trusted. The first question anyone asks of one —
an auditor, an investigator, an interviewer — is whether it could have been changed after
the fact. "The application only ever inserts" is not an answer, because the application is
exactly the thing under suspicion, and it is one careless migration away from not being
true.

Revoking `UPDATE` and `DELETE` from the application's database role was considered and
rejected: it is undone by the next role change, and nothing in the schema records that the
guarantee was ever intended.

## Decision

A trigger refuses both operations, for every connection, including the application's own:

```sql
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();
```

`TRUNCATE` is deliberately left alone — the trigger is `FOR EACH ROW`, so it does not fire.
Integration tests need to reset the table, and the application never truncates anything. The
rule that matters is that no individual entry can be altered or made to disappear.

## Consequences

**Foreign keys had to be removed from this table**, and that is the interesting part.

`audit_logs` inherited `actor_user_id REFERENCES users(id) ON DELETE SET NULL` from the
initial schema. `ON DELETE SET NULL` is a write into `audit_logs` performed by the database
on another table's behalf — so the trigger refused it, and no user or session could ever be
deleted once it appeared in the history. The two rules were in direct conflict.

The general lesson, which generalises past this project: **any foreign key with an
`ON DELETE` action is a mutation path into an immutable table.** An audit entry is a
snapshot of what was true when it was written, not a live join. It records ids as plain
values, and an id that no longer resolves is itself a fact worth keeping. Reads use
`LEFT JOIN`, so an entry naming a deleted user renders with a null actor rather than
vanishing from the history.

Forced sign-outs and other privileged actions write their audit entry with the strict
writer, not the tolerant one: an action that history cannot record fails rather than
proceeding unrecorded. Login attempts use the tolerant writer, because refusing a valid
sign-in over a bookkeeping failure trades a logging problem for an outage.

The audit log records the email attempted on a failed login. It never records the password —
not in plain text, not hashed, not on failure. An integration test asserts a known password
string does not appear anywhere in the resulting entries.
