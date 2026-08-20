# 4. Run migrations with an explicit runner, not the container entrypoint

**Status:** Accepted · **Date:** 2026-08-20 · **Supersedes:** the original compose mount

## Context

The schema was originally applied by mounting `database/postgres/migrations` into the
Postgres image's `/docker-entrypoint-initdb.d`.

That directory runs **only when the data directory is empty**. Any migration written after
the container was first created is silently skipped, and every developer's database drifts
depending on when they happened to create their volume. It also does nothing whatsoever for
a managed database in production, which has no entrypoint to hook.

The failure mode is the dangerous kind: everything appears to work, and the difference only
surfaces as a missing column at runtime.

## Decision

A runner in `apps/api/src/database/migrate.ts`, exposed as `npm run migrate`. It applies
every unapplied `.sql` file in filename order, each inside its own transaction, and records
what it applied in a `schema_migrations` table.

## Consequences

Local, CI and deployed environments all reach the schema the same way, by running the same
command. CI proves it: the pipeline runs migrations against an empty PostgreSQL service
before the integration suite, so a broken migration fails the build rather than a developer's
afternoon.

A failed migration rolls back rather than leaving the schema half-applied. Migrations are
still forward-only — there are no down migrations, because rolling a schema backwards in a
system holding financial records is usually the wrong instinct; the correction is another
forward migration.

The compose mount is left in place so a first-time clone still comes up populated, but it is
no longer the mechanism anything depends on.
