# 17. Two row-level security models, side by side

Date: 2026-09-04

## Status

Accepted. The receipt portal's isolation suite passed ten of ten against a live
Supabase project (Tokyo, free tier) on 2026-09-04, in sixteen seconds.

## Context

ADR 14 put row-level security into this platform with a hand-rolled pattern: a
`NOLOGIN` role adopted for one transaction via `set_config(..., true)` and
`SET LOCAL ROLE`, so that a pooled connection carries no user context past
COMMIT. It works, it is proven by tests that SELECT with no per-user filter, and
it is unusual. Most teams who say "we use RLS" mean Supabase's model: a policy
that compares a column to `auth.uid()`, evaluated against a JWT that the
platform's API gateway has already verified.

Having built only one of the two, the honest claim available was "I have
implemented RLS", which does not say whether the implementer could tell you when
the other model is the right one. So a second, deliberately small consumer of
this API — the [receipt portal](https://github.com/marcelgilbertdev-oss/receipt-portal)
— was built entirely on Supabase, enforcing the same guarantee ("a customer sees
only their own rows and files") the other way. This record is the comparison.
The portal is the excuse for it.

## Decision

Keep ADR 14's request-lane pattern on this platform. Use Supabase's model in the
portal, because there it is the native one. Do not blend them. Record where each
is right.

## The two models

**Identity.** In the request lane, identity is a transaction-local setting the
API writes after it has authenticated the caller against its own sessions table.
In Supabase, identity is `auth.uid()`, read from a JWT that PostgREST verified
before the query reached PostgreSQL. Both are "the application told the database
who is asking"; the difference is *which* application. Here it is code this repo
controls and tests. There it is Supabase's gateway, which is trusted the way a
platform is trusted — by reading its documentation and its incident history, not
its source.

**Where the privilege boundary lives.** The request lane is a *role*: the
transaction really is running as `zerofayyz_request`, with the grants that role
holds and nothing more, and the policy is a second fence inside the first. On
Supabase the query runs as `authenticated` — a single shared role for every
signed-in person — and the policy is what separates them. This is the fact that
changes how a new table must be treated:

- Here, a new table with no grant to the request lane is invisible to it. Default
  deny extends to schema that does not exist yet (ADR 14).
- On Supabase, default privileges already grant `anon` and `authenticated` on
  every new table in `public`, and the anon key is published in the browser
  bundle by design. A new table without `enable row level security` is
  world-readable. RLS there is not a second lock on a closed door; for a table in
  `public`, it is the door.

The portal's migration therefore revokes the default grants and re-grants only
SELECT to `authenticated`, so a forgotten policy is not the only thing between a
visitor holding the published key and the rows. That line is the one most
Supabase projects do not have.

**Pooling.** ADR 14's pattern exists *because of* the connection pool: a role
and a context that outlive a transaction leak into the next request on the same
connection, and `SET LOCAL` is the whole answer. Supabase's model does not have
this problem, because the context is not connection state at all. It is a JWT
claim parsed per request and exposed through `auth.uid()`, which reads
`request.jwt.claims` from a setting that PostgREST sets transaction-locally
itself. The guarantee holds through Supabase's pooler for the same reason the
request lane's does — the context is transaction-scoped — but the developer did
not have to know that to get it right. That is the model's real advantage: the
sharp edge is inside the platform.

**Writes.** Both designs deny by default. In the request lane the only write is
filing a refund request, guarded by a `WITH CHECK` policy. In the portal there
is no write policy at all, so every write from a customer is refused and the
Edge Function — the only runtime holder of the service-role key — is the sole
write path. The absence of a policy is the write protection; nothing further is
needed to state it.

**Files.** The platform has no object storage. The portal's storage policy
authorises on the first path segment of the object name, and a CHECK constraint
on the receipts table requires `storage_path` to equal
`<customer_id>/<receipt_id>.pdf`. The table and the bucket therefore cannot
disagree about who owns a file, which is the property that matters: a policy
keyed on a path convention is only as safe as the convention.

**Bypass.** Both models have a privileged lane that skips RLS — the owning role
here, `service_role` there — and both state it rather than hide it. ADR 14
explains why RLS is not `FORCE`d. Supabase's is the familiar version of the same
shape, and it is worth saying that the request-lane design was already borrowing
that split before this comparison was written.

## When each is right

Use Supabase's model when Supabase is already the auth provider and the API
gateway. Adding a `SET LOCAL ROLE` lane there would re-implement, worse, a thing
the platform provides, and it would fight PostgREST's own role switching.

Use the request-lane pattern when the application owns authentication, connects
to PostgreSQL through its own pool, and the database must not trust a shared
application role. It costs a `NOLOGIN` role, a helper that opens the
transaction, and the discipline of routing user-serving reads through it. What it
buys is a role boundary underneath the policy boundary, and no dependency on a
gateway to have verified anything.

Do not use either as a substitute for authorisation checks in the API. Both are a
property of the database that survives the API being wrong. They are not a
reason for the API to be wrong.

## Consequences

The claim this platform can make is now specific: row-level security has been
implemented two ways, with the same guarantee proven the same way in both — an
authenticated client, a SELECT with no per-user WHERE clause, rows absent
because a policy refused them — and the difference between them is recorded
here rather than remembered.

What was given up in the portal, stated plainly: the identity claim is verified
by someone else's gateway; every signed-in person shares one database role; and
default grants had to be revoked by hand to reach the posture ADR 14 gets from
default deny. What was given up here, equally plainly: the request lane is code
this repo has to keep correct, and a future route that forgets to use it gets
the service lane's view.

### What the live run added

Three things the architecture above did not predict, recorded because the next
person will hit them too.

**Default-deny reaches the service role.** Supabase's project-creation form now
offers "Automatically expose new tables" and "Enable automatic RLS" as
switches, and its own copy recommends turning the first one off. With it off, a
new table carries no default grants for *any* role — `anon`, `authenticated`,
and `service_role` alike. The secret key was refused with `42501 permission
denied` until the migration granted the service role explicitly. That is the
posture ADR 14 describes ("default deny extends to schema that does not exist
yet") arriving on Supabase as a first-class option, and it narrows the gap this
record opened with: a Supabase project created with that switch off behaves like
the request lane's database, and the "RLS is the door" warning applies only to
projects that leave the default on. The migration keeps the grant explicit either
way, so it is correct on both kinds of project.

**The keys have been renamed.** What every job advertisement still calls the
*anon key* is now the *publishable key* (`sb_publishable_…`), and *service_role*
is a *secret key* (`sb_secret_…`). Same two roles, same rule; the names on a
proposal should be the current ones, with the old ones in parentheses.

**A failed setup must still clean up.** The first live run failed inside the
fixture builder and left an orphaned auth user behind, because teardown only knew
about customers that had been fully constructed. The suite now records every
user it creates before asserting anything. A test that proves isolation but
leaks accounts on failure would have been the kind of evidence that argues
against itself.
