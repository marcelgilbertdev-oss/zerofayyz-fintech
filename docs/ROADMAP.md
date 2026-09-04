# Roadmap

Phases 1 through 5 are complete and deployed. This describes what comes next, in what order,
and why that order.

**The governing rule:** each phase must end with something *finished* — tested, deployed, and
documented — before the next begins. A platform with five half-built features reads worse to
a reviewer than one with two complete ones. That judgement is what produced Phase 1 rather
than a broader, shallower version of it.

**The second rule:** applications go out between phases, not after all of them. Hiring
pipelines run four to ten weeks. Building through that wait is free; delaying the first
application to build more is not.

---

## Phase 1 — Payments foundation ✅ Complete

Shipped and live. Stripe hosted Checkout, signature-verified webhooks, an append-only
transaction ledger, live dashboard metrics, migrations, tests across three layers, a
production smoke suite, CI/CD, architecture and decision documentation, and a public
deployment across three colocated regions.

## Phase 2 — Three clients, two languages, one contract ✅ Complete

Vue 3 and Svelte 5 clients consuming the same API unmodified through a shared Zod contract;
English and Japanese with translations enforced by the type system; WCAG 2.1 AA scanned by
axe-core in CI against both locales; a caller-chosen payment amount bounded by the route
schema; and a production smoke suite that asserts content unique to the newest build, after
a failed deploy once hid behind checks both builds satisfied.

---

## Phase 3 — Authentication, roles and the admin console ✅ Complete

Shipped and live. scrypt password hashing with per-hash cost parameters; opaque server-side
sessions storing only the cookie's SHA-256; `viewer` / `operator` / `admin` guards enforced
on the API; an append-only audit log made immutable by a database trigger; live session
presence and remote sign-out; failure-only login rate limiting; and account-enumeration
protection via decoy-hash verification.

The public dashboard deliberately stayed public. A reviewer must never meet a login wall,
and showing both halves demonstrates a decision about where the boundary belongs rather
than a padlock on the front door.

**What proved it works:** integration tests that make the *refused* request — anonymous
gets 401 everywhere, a viewer gets 403 everywhere, an operator reads the audit log and
nothing else. A guard written beside a route is not a guard until a test walks through the
wrong door. Plus a live charter run in which an administrator ended a session and its
holder's unchanged, unexpired cookie failed on the next request.

**Deliberately not in scope:** password reset, social login, multi-factor. One provider,
done properly.

---

## Phase 4 — Refunds and account management ✅ Complete

Shipped and live: request/approve with the four-eyes rule enforced by API and
CHECK constraint, requester withdrawal (a feature the e2e suite proved missing
by deadlocking without it), Stripe refunds keyed idempotently on the request
id, the ledger moved only by the signed charge.refunded webhook, and account
create / re-role / disable / enable — never against yourself, with disabling
revoking every live session in the same statement.

**Why it was next:** the admin console reads nearly everything and writes almost nothing. An
operator's day is spent *acting*, and a refund is the canonical payments action — money
moving backwards, with an audit trail proving who authorised it and when.

**Deferred from this phase:** the Payments, Transactions and Customers sidebar
pages — now Phase 5's whole scope.

**What proved it works:** the refund event replayed and changing nothing; an
approval racing a rejection losing cleanly with Stripe never called; a Stripe
failure releasing the claim so the request stays decidable; and the schema
refusing a self-approval even from raw SQL.

---

## Phase 5 — The ledger pages and the staff door everywhere ✅ Complete

Shipped and live: Payments (status-filterable, limit/offset pagination with exact
`COUNT(*) OVER ()` totals), Transactions (the raw Stripe event stream with provider event
ids visible — the idempotency constraint made inspectable), and Customers (settled volume
aggregated in SQL, unsettled money shown as $0.00 rather than explained away). Every
sidebar destination is real; the last PLANNED badges are gone.

Then the staff door reached the other two frameworks: the Vue and Svelte clients each
carry an **Operator area** — the same sign-in, session cookie, rate limiter and verbatim
refusals as the admin console, driving the operator-gated audit trail — implemented once
in Pinia and once in runes against a single behavioural specification
([ADR 10](decisions/0010-put-the-staff-door-inside-the-spa-clients.md)).

**What proved it works:** the two client suites assert the same contract
assertion-for-assertion; a live walk in which the Svelte panel's audit trail opened
showing the Vue panel's sign-in, sign-out and one deliberate failure as its newest rows;
and a smoke check per client that `/auth/me` answers a clean 401 through each Vercel
rewrite.

---

## Phase 6 — Operational visibility ✅ Complete

**Why next:** Piece's posting asks for "monitoring, alerting and support" by name. The health
endpoint exists; nothing consumed it until the first slice below.

**Shipped early (2026-08-22):**

- `/api/v1/ready` distinct from `/health` — liveness and readiness are different questions.
  `/health` stays 200 while degraded, because a process that can describe its own
  degradation is alive; `/ready` returns 503 the moment the database is unreachable, so an
  orchestrator drains the instance instead of routing payments into a dead ledger. Tested
  on both branches, including the divergence itself: database down asserts 503 from one
  endpoint and 200 from the other in the same test.
- Scheduled monitoring with alerting: the 30-check smoke suite now runs hourly against the
  live deployment (`production-watch.yml`), and a failed scheduled run is GitHub's own
  email to the owner — an alert with a person on the end of it and no new infrastructure.

**Completed 2026-08-22:**

- Structured JSON logging: service/env base fields, `authorization`, `cookie`,
  `stripe-signature` and `set-cookie` redacted outright, and a request id on every line
  that is also returned in `x-request-id`. An upstream id is honoured so a trace beginning
  at a proxy survives — but validated first, since that value is echoed into a response
  header and written into logs. Tests refuse CRLF header splitting, a 500-character flood,
  and a quote-brace sequence that would corrupt the JSON a log query depends on.
- ~~Error tracking~~ — **shipped**: Sentry live in production, reports carry the request id,
  and cookies/`authorization`/`stripe-signature`/`set-cookie`/query string are scrubbed before
  any event leaves the process.
- ~~Alert routing, so a broken webhook reaches a person rather than a log file~~ —
  **shipped (2026-08-28)**: a *signed* webhook probe in the smoke suite, run hourly.
  (the audit log panel this phase originally planned shipped in Phase 3)

**Why a positive control rather than an error count.** Two failure modes had to be told
apart. A secret that is *missing* was already caught: `/health` reports the webhook
`unconfigured` and the hourly run fails. A secret that is *present but stale* — rotated in
Stripe, never updated on Render — was invisible, because health reports the variable's
presence, not its correctness. Every real delivery would be rejected, the ledger would stop
moving, and nothing would say so. Counting non-2xx responses cannot detect it either: the
suite itself posts an unsigned and a forged webhook on purpose, so 400s are normal traffic
here, and alerting on them would produce the report nobody opens.

So the check signs a real event with the deployed secret and requires the endpoint to accept
it. It uses `payment_intent.created` — a genuine Stripe type this handler does not act on —
so a verified delivery returns `processed: false` and writes nothing to the live ledger.

**What proved it works:** the check was watched failing for the right reason before it was
trusted — run against a local API with a deliberately mismatched secret, it fails naming the
divergence and its consequence; with the correct secret it passes, writing nothing. A missing
secret makes it *skip* and say so on a public run, and `SMOKE_REQUIRE_WEBHOOK_PROBE=1` (set
in the scheduled monitor) turns that skip into a failure, because a monitor that quietly
stops monitoring is worse than one that never started. Breaking the *production* secret to
watch the hourly alert fire end-to-end is the one step left, and it is deliberately the
founder's to take — it briefly stops real deliveries.

**The drill was run on 2026-08-29, and the alert fired.** Three dispatches of
`production-watch.yml` against the live deployment: baseline **30/30** with the
real secret; then `STRIPE_WEBHOOK_SECRET` replaced on Render with a well-formed
wrong value, giving **29/30** — the probe failing with *"a validly signed
delivery was rejected with 400 … real Stripe events are being refused and the
ledger has stopped moving"*, a red run, and GitHub's email to the owner —
**received on the owner's phone at 10:13**, subject *"Production watch: All jobs
have failed"*, which is the link most monitoring stories assert and never check;
then the secret restored and **30/30** again.

The part worth keeping: during the break, **the other twenty-nine checks all
passed.** `/health` still reported the webhook `configured`, the dashboard still
read 6 of 6 live, the ledger still served. Only the positive control noticed,
which is the argument for building it that way — an error-count alarm would have
seen nothing, because this suite posts forged webhooks deliberately and 400s are
normal traffic here. An alert nobody has watched fire is not monitoring; this
one has been watched, and watched stop.

---

## Shipped beyond the plan ✅

Three pieces landed that no phase asked for, pulled forward because live job
postings screen for them by name. Recorded here so the roadmap stays the map of
what exists, not what was once intended:

- **Row-level security in a request lane** (2026-08-31, migration 007, ADR 14).
  User-serving reads adopt a NOLOGIN role per transaction; policies — not WHERE
  clauses — decide row visibility. Proven by tests that SELECT with no per-user
  filter.
- **A durable job queue in PostgreSQL** (2026-09-01, migration 008, ADR 15).
  Atomic claims over FOR UPDATE SKIP LOCKED, lease-based crash recovery, capped
  backoff, dead-lettering, idempotent enqueue, and a self-chaining recurring
  pattern. First consumer: hourly session-retention cleanup. Honest guarantee:
  at-least-once. Surface: `/admin/jobs`.
- **Passwordless sign-in via magic links** (2026-09-01, migration 009, ADR 16).
- **A fifth consumer on Supabase** (2026-09-04): the [receipt portal](https://github.com/marcelgilbertdev-oss/receipt-portal) — [live](https://receipt-portal-one.vercel.app) — enforces the same row-visibility guarantee with Supabase's `auth.uid()` policy model, so the two RLS models could be compared honestly ([ADR 17](decisions/0017-two-row-level-security-models.md)). Its `sync-payments` Edge Function consumes this API, and the hourly production watch keeps the free-tier project awake by expecting a `401` refusal.
  SHA-256 token hashes at rest, single-use via one atomic UPDATE, 15-minute
  expiry decided in SQL, always-202 anti-enumeration, per-mailbox rate limit.
  The email leg is the queue's second consumer — unconfigured mailer = a
  visible dead job on `/admin/jobs`, never a silent failure. Completes the
  "passwordless authentication with session revocation" requirement named in
  operations-portal briefs.
- Phase 9's "Go service — one narrow, well-chosen responsibility" was already
  satisfied by the **reconciler** before this section existed; noted so nobody
  builds it twice.

---

## Phase 7 — Activity events in MongoDB

**Why next:** it demonstrates polyglot persistence with an honest reason rather than
résumé-driven database collecting. Piece's nice-to-haves name document databases explicitly.

**Scope:**

- A `services/activity-log` service writing user-facing activity events to MongoDB
- Clear separation: **financial records stay in PostgreSQL**, where constraints and
  transactions matter. Behavioural events — page views, filter changes, exports — go to
  MongoDB, where the schema varies and losing one costs nothing
- The dashboard reads recent activity from it

**The argument that matters:** being able to explain *why two databases* is worth more than
having two. The wrong version of this phase is moving payments into MongoDB.

---

## Phase 8 — Infrastructure as code

**Why next:** the current deployment is reproducible for the API (`render.yaml`) but the
database and dashboard were configured by hand. That gap is the difference between a project
and infrastructure.

**Scope:**

- Terraform or Pulumi definitions for the database and hosting
- A documented restore path: destroy everything, rebuild from the repository, restore the
  schema from migrations
- Secrets managed properly rather than pasted into dashboards
- Preview environments per pull request

**What proves it works:** actually destroy and rebuild it once, and time it.

---

## Phase 9 — Exploratory

Only worth doing if a target role names them, and each should be a genuine slice rather than
a stub:

- **Go service** — one narrow, well-chosen responsibility, not a rewrite
- **Solidity settlement experiment** — Piece works in fractional securities, so a tokenised
  ownership record is topical, but it must not touch the real payment path
- **React Native client** — a read-only mobile view of the same API

---

## How to work through a phase

The pattern that produced Phase 1, worth repeating:

1. **Write the decision record first** when a choice has trade-offs. Deciding on paper is
   cheaper than deciding in code.
2. **Build the vertical slice** — database, API, interface — before broadening.
3. **Test at the layer that can actually catch the failure.** Unit tests cannot see SQL.
4. **Deploy it before starting the next thing.** Unshipped work has no evidence attached.
5. **Update the README** so the shipped list stays true.
6. **Write a short case-study entry** — one paragraph on what was hard and what it taught.
   That paragraph is what makes the work legible to a non-engineer.

Each phase should take days, not months. If a phase is stretching, it's too big — cut it.

---

## Keeping the demo honest

Two standing chores, neither optional:

- **The README's shipped list must match the repository.** A promise the code doesn't keep is
  worse than an unbuilt feature honestly labelled.
- **`node scripts/production-smoke.mjs` must pass** before you send the link to anyone. It
  takes three seconds and catches a demo that broke since you last looked.
