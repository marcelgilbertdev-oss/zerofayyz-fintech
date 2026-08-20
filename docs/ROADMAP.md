# Roadmap

Phase 1 is complete and deployed. This describes what comes next, in what order, and why
that order.

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
transaction ledger, live dashboard metrics, migrations, 31 automated tests across three
layers, a nine-check production smoke suite, CI/CD, architecture and decision documentation,
and a public deployment across three colocated regions.

---

## Phase 2 — Authentication and the admin view

**Why next:** it is the single most-requested feature in job postings, and the README
currently lists a user dashboard and admin console as roadmap rather than shipped. Closing
that gap makes the repository's claims and its contents match exactly.

**Scope:**

- Session-based authentication, one provider, email and password to start
- A protected route: the dashboard requires a session
- Two roles — `customer` and `admin`. The `users` table already carries a `role` column with
  a CHECK constraint, so the data model is ready
- A customer view that shows only that customer's payments
- An admin view that shows every payment plus the audit log

**What proves it works:** an integration test asserting a customer cannot read another
customer's payments — an authorisation test, not just an authentication one. That distinction
is where most real breaches live.

**Deliberately not in scope:** password reset flows, social login, multi-factor. One provider,
done properly.

---

## Phase 3 — Operational visibility

**Why next:** Piece's posting asks for "monitoring, alerting and support" by name. The health
endpoint exists; nothing consumes it yet.

**Scope:**

- Structured JSON logging with a request id threaded through every log line
- An `/api/v1/ready` endpoint distinct from `/health` — liveness and readiness are different
  questions and conflating them causes bad restarts
- Error tracking, and an alert when the webhook endpoint starts returning non-2xx
- A dashboard panel reading the real `audit_logs` table, replacing the "Audit log" nav item
  currently marked Planned

**What proves it works:** deliberately break the webhook secret, confirm the alert fires,
restore it, confirm recovery. An alert nobody has ever seen fire is not monitoring.

---

## Phase 4 — Activity events in MongoDB

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

## Phase 5 — Infrastructure as code

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

## Phase 6 — Exploratory

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
