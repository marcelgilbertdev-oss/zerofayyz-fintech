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

## Phase 5 — Operational visibility

**Why next:** Piece's posting asks for "monitoring, alerting and support" by name. The health
endpoint exists; nothing consumes it yet.

**Scope:**

- Structured JSON logging with a request id threaded through every log line
- An `/api/v1/ready` endpoint distinct from `/health` — liveness and readiness are different
  questions and conflating them causes bad restarts
- Error tracking, and an alert when the webhook endpoint starts returning non-2xx
- Alert routing, so a broken webhook reaches a person rather than a log file
  (the audit log panel this phase originally planned shipped in Phase 3)

**What proves it works:** deliberately break the webhook secret, confirm the alert fires,
restore it, confirm recovery. An alert nobody has ever seen fire is not monitoring.

---

## Phase 6 — Activity events in MongoDB

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

## Phase 7 — Infrastructure as code

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

## Phase 8 — Exploratory

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
