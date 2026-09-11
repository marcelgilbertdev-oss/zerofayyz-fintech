# 19. A keep-alive must make the request the provider counts

Date: 2026-09-11

## Status

Accepted. Portal migration 0002 applied to the live Supabase project and the
production-watch job green with both controls on 2026-09-11.

## Context

The receipt portal (ADR 17) runs on a Supabase free-tier project, which is paused
after about a week without activity. To prevent that, the platform's scheduled
`production-watch.yml` carried a `keep-supabase-awake` job since 2026-09-04. It
made one request: an anonymous read of `public.payments`, which PostgreSQL
refuses with `401` / SQLSTATE `42501` because `anon` holds no grant on that
table. The job's own comment reasoned that the refusal "still comes from the
database, which is what keeps the project awake", and treated `401` as healthy.

On 2026-09-11 Supabase emailed that the project "has not seen sufficient
activity for more than 7 days" and would be paused. Every run of the job in that
week was green. The assumption in the comment was never verified against what
the provider actually measures, and the provider's own warning refuted it.

This is the third time this platform has shipped the same shape of defect. The
ingestion pack already recorded it twice: a health check that reported a webhook
secret as *present* rather than *correct* (2026-08-28), and an error-tracker
status that reported a DSN as *configured* rather than *initialised* (ADR 18,
2026-09-09). Each time the check asserted something adjacent to the property it
was named for, and each time it stayed green while the property failed.

## Decision

The job now makes two requests, and both must pass.

1. **Positive control.** `POST /rest/v1/rpc/keepalive` as `anon`, requiring
   `200`. `public.keepalive()` is added by portal migration 0002: `select now()`,
   `SECURITY INVOKER`, `set search_path = ''`, execute granted to `anon`. It
   touches no customer table and reveals nothing a clock does not. This is the
   request that resets the pause timer, because it is a request the database
   *serves*.
2. **Negative control.** The original anonymous read of `payments`, still
   requiring `401` / `42501`. A `200` here is a regression: someone granted
   `anon` access to customer rows.

The comment that claimed a refusal keeps the project awake is deleted and
replaced with what was learned. The cron expression stays hourly, but the
documentation stops calling the job hourly: GitHub fires scheduled jobs when it
has capacity, and this one runs every three to five hours in practice. That is
well inside a seven-day window and is not the cause of the warning.

## What is still not known

Exactly what Supabase counts as "activity" is not documented in a form this
record can cite. The assumption now is that a request the database executes
counts and a request PostgREST or PostgreSQL refuses does not; the warning
supports it and the next seven days will confirm or refute it. It is registered
in Gabriel's unknowns register rather than asserted here. If the project is
warned again with the positive control green, this record is wrong and the next
one says so.

## Consequences

The rule the pack already carried is now stated in its general form: **a check
must measure the property it is named for, with a positive control that exercises
the property and requires success.** A negative control (bad input is refused)
proves the fence; only a positive control (good input is accepted) proves the
thing inside it is alive. A keep-alive that only ever gets refused is a fence
test wearing a keep-alive's name.

The portal's migration history is now tracked by the Supabase CLI (`migration
repair` marked 0001 applied; 0002 went through `db push`), so future schema
changes to the portal go through files in `supabase/migrations/` rather than the
SQL editor.
