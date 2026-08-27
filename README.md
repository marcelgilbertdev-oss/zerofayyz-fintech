# ZEROFAYYZ FINTECH

## Cloud Payments & Operations Platform

[![CI](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech/actions/workflows/ci.yml/badge.svg)](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech/actions/workflows/ci.yml)

**Portfolio prototype — Stripe sandbox only. No real funds move.**

A payments and operations platform: hosted Stripe Checkout, signature-verified webhooks, an
append-only transaction ledger in PostgreSQL, and a server-rendered operations dashboard.
Built to be read as much as run — the decisions are documented, the tests are structured
around how payment systems actually fail, and everything is gated by CI.

- **Live demo (Next.js):** **https://zerofayyz-fintech.vercel.app**
- **Try it in three minutes:** [docs/portfolio/TRY_IT_IN_THREE_MINUTES.md](docs/portfolio/TRY_IT_IN_THREE_MINUTES.md)
- **Same API, Vue 3 client:** https://zerofayyz-fintech-vue.vercel.app
- **Same API, Svelte 5 client:** https://zerofayyz-fintech-svelte.vercel.app
- **Architecture:** [docs/architecture/SYSTEM_OVERVIEW.md](docs/architecture/SYSTEM_OVERVIEW.md)
- **Quality strategy:** [docs/QUALITY_STRATEGY.md](docs/QUALITY_STRATEGY.md)
- **Decision records:** [docs/decisions/](docs/decisions/)
- **How it works (full walkthrough):** [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)
- **Roadmap:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Case study (non-technical):** [docs/portfolio/CASE_STUDY.md](docs/portfolio/CASE_STUDY.md)
- **Manual acceptance test:** [docs/runbooks/MANUAL_ACCEPTANCE_TEST.md](docs/runbooks/MANUAL_ACCEPTANCE_TEST.md)
- **Hosting, accounts and cost:** [docs/runbooks/HOSTING_AND_ACCOUNTS.md](docs/runbooks/HOSTING_AND_ACCOUNTS.md)
- **Phone and browser testing:** [docs/runbooks/MOBILE_AND_BROWSER_TESTING.md](docs/runbooks/MOBILE_AND_BROWSER_TESTING.md)
- **Context pack for an AI assistant:** [docs/knowledge/EXTERNAL_AI_CONTEXT.md](docs/knowledge/EXTERNAL_AI_CONTEXT.md)
- **The briefing — everything built and why:** [docs/portfolio/THE_BRIEFING.md](docs/portfolio/THE_BRIEFING.md)

## Stack

TypeScript throughout, ESM, Node 20+.

| Layer | Choice |
| --- | --- |
| API | Fastify 5, JSON-schema validated responses |
| Web | Next.js 16, React 19, server components, Tailwind |
| Database | PostgreSQL 18, `pg`, hand-written SQL |
| Payments | Stripe 22, hosted Checkout, signed webhooks |
| Auth | scrypt (`node:crypto`), opaque server-side sessions, role-based guards |
| Tests | `node --test` for unit and integration, Playwright for end-to-end, Cucumber/Gherkin for business rules |
| CI | GitHub Actions — typecheck, lint, unit, integration, end-to-end, MCP handshake |
| Agent access | MCP server (stdio) exposing the QA surface — see [apps/mcp](apps/mcp/README.md) |

## Shipped

- Hosted Stripe Checkout, with the local payment id as the idempotency key so a retry cannot
  open a second session for one payment
- Webhook handling with signature verification against the raw body, and idempotency enforced
  by a unique constraint rather than by application branching
- Transaction ledger, payment status lifecycle, and audit logging written in one statement
- Live dashboard: platform health, gross volume, success rate, pending settlement, recorded
  events, twelve-day volume history, and recent transactions — all derived from the database
- Health endpoint reporting real database latency and real integration configuration
- Migration runner with a `schema_migrations` table, applied the same way in every environment
- Japanese and English, with locale negotiated once server-side and translations
  enforced by the type system — a missing string is a compile error, not an English
  word in a Japanese page
- WCAG 2.1 AA verified by axe-core in CI against both locales
- Three independent frontends on one API — Next.js 16, Vue 3 (Composition API + Pinia) and
  Svelte 5 (SvelteKit, runes) — sharing one Zod contract that validates every response at the boundary.
- An MCP server exposing the platform's QA surface to an agent — running the allowlisted test
  suites, validating the live API against the shared contract, and proving webhook idempotency
  by replaying a signed event. Contract drift used to be catchable only in a user's browser;
  it is now a command and a CI gate. See [apps/mcp](apps/mcp/README.md).
- The platform's payment rules stated in Gherkin and executed by Cucumber — four-eyes refund
  approval, sign-in responses that reveal nothing, zero-decimal yen, webhook idempotency, and
  pagination regression coverage — five features, thirteen scenarios, run as a tenth CI job.
  See [apps/web/features](apps/web/features) and
  [ADR 0012](docs/decisions/0012-state-payment-rules-in-gherkin.md).
  The API is consumed unmodified by all three, so the contract is demonstrated rather than
  asserted
- Authentication and roles: scrypt password hashing with cost parameters stored inside each
  hash, opaque server-side sessions whose cookie value is stored only as a SHA-256, and
  `viewer` / `operator` / `admin` guards enforced on the API rather than in the page
- Admin console: live presence ("who is signed in right now", read from the same SQL
  predicate that admits people), remote sign-out that ends a session on its holder's next
  request, audit history, and account listing
- An append-only audit log the database itself refuses to edit or delete, enforced by a
  trigger rather than by convention
- Login rate limiting that counts failures only, so a shared demo account cannot be locked
  out of its own demo by a burst of successful sign-ins
- Refunds with a four-eyes rule: an operator requests, an administrator approves, and the
  same account can never do both — enforced by the API and again by a CHECK constraint.
  Approval calls Stripe with the request id as its idempotency key; the ledger is updated
  only by the signed charge.refunded webhook, idempotently, like every other event
- Requesters can withdraw their own pending request; one pending request per payment is
  enforced by a partial unique index
- Account management from the console: create staff, change roles, disable and enable —
  never against your own account, and disabling revokes every live session in the same
  statement
- Full ledger pages — Payments (status-filterable, paginated with exact totals),
  Transactions (the raw Stripe event stream, provider event ids visible — the idempotency
  constraint made inspectable), and Customers (per-customer settled volume aggregated in
  SQL). Every sidebar destination is real; the last PLANNED badges are gone
- The staff door on all three frontends: the Vue and Svelte clients each carry an operator
  panel — the same sign-in, session cookie, rate limiter and verbatim refusals as the admin
  console, driving the same operator-gated audit-trail read — implemented once in Pinia and
  once in runes against one shared behavioural specification, with the two test suites
  asserting the same contract line for line
- Account-enumeration protection: a missing account is verified against a decoy hash, so a
  wrong password and a nonexistent user return byte-identical responses in comparable time
- Load testing with asserted latency and error-rate thresholds, scheduled in CI
- Structured JSON logging with a request id on every line and returned to the caller in
  `x-request-id` — an upstream id is honoured so a trace is not broken here, but only after
  validation, because that value is echoed into a header and written into logs
- Readiness separated from liveness: `/health` stays 200 while degraded because a process
  that can describe its own degradation is alive, while `/ready` returns 503 the moment the
  ledger is unreachable, so an orchestrator drains the instance instead of routing payments
  into it
- Monitoring with a person on the end of it: the smoke suite runs hourly against production,
  and a failed scheduled run is an email rather than a log line
- A container image that has actually served traffic — multi-stage, production dependencies
  only, unprivileged, health-checked against `/ready`, and started in CI on every push
- Accessibility verified at phone width as well as desktop, in both locales. Adding the
  narrow viewport immediately found a WCAG A failure that had been shipping under a green
  suite: the ledger tables only become scroll containers when they overflow, so a keyboard
  user could not scroll them and no desktop-width scan could see it
- An independent ledger reconciler in **Go** — a separate process that re-derives every
  payment's state from the append-only event log and exits non-zero when it disagrees with the
  payments table. In a different language on purpose: a checker that shares code with the thing
  it checks agrees with its bugs. It reads and never writes, because something able to "fix" a
  discrepancy is also able to destroy the evidence of it
- Kubernetes manifests that have been **applied, not just linted** — two replicas, non-root,
  read-only root filesystem, `maxUnavailable: 0`, and readiness and liveness probes pointed at
  different endpoints. Removing the database took both pods out of the Service's endpoints with
  zero restarts, which is the whole argument for having two health endpoints, demonstrated
- Error tracking live in production, reporting with the request id attached so an issue and a
  log line point at the same request — and scrubbed explicitly rather than by SDK default:
  cookies, `authorization`, `stripe-signature`, `set-cookie` and the whole query string are
  stripped before any event leaves the process, because on a payments API an unscrubbed error
  report turns an incident dashboard into a credential store. Inert without a DSN by design,
  and `/health` says `unconfigured` rather than pretending
- Visual regression on the chrome at desktop and phone width, deliberately excluding
  data-driven pages: a suite that fails whenever the ledger moves is one people learn to ignore
- 331 automated tests across ten suites, all gated in CI, plus a 28-check smoke suite
  that verifies the live deployment from outside

## Security posture

The public half of this platform is genuinely public: the dashboard is readable without an
account, and the test-payment endpoint accepts anonymous calls, because a reviewer must not
meet a login wall. What follows describes how the privileged half is separated from it.

| Concern | Approach |
| --- | --- |
| Password storage | scrypt, memory-hard, cost parameters stored per hash so they can be raised without locking anyone out ([ADR 7](docs/decisions/0007-hash-passwords-with-scrypt-from-the-standard-library.md)) |
| Session tokens | 32 random bytes; only their SHA-256 reaches the database, so a dump grants no one a session ([ADR 8](docs/decisions/0008-use-opaque-server-side-sessions-not-jwts.md)) |
| Revocation | Evaluated in SQL on every request — an ended session dies immediately, cookie unchanged |
| Cookies | `HttpOnly`, `Secure`, `SameSite=Lax` (Lax, not Strict, so the Stripe return keeps the session; a test pins this) |
| Authorisation | Checked on the API for every request; hidden UI is presentation, and the integration suite proves the refusals independently |
| Brute force | Five failed attempts per account per fifteen minutes, keyed on the attempted account rather than a forgeable client address |
| Enumeration | Decoy-hash verification for missing accounts; identical responses and comparable timing |
| Audit integrity | Append-only by database trigger; no foreign key with an `ON DELETE` action may write into it ([ADR 9](docs/decisions/0009-make-the-audit-log-append-only-in-the-database.md)) |
| Privacy | Client identity is a keyed hash of the network prefix, never an IP address — enough to distinguish sessions and rate-limit abuse, not enough to locate a person |
| Security headers | Every origin: `nosniff`, `frame-ancestors 'none'`, referrer policy, HSTS; the JSON API additionally ships `default-src 'none'` and CORP. Asserted exactly in unit tests, on error paths too, and verified from the wire by the smoke suite |
| Secrets | Never in the repository; `SESSION_SECRET` is generated by the platform at deploy. Recovery paths documented in [CREDENTIAL_RECOVERY.md](docs/runbooks/CREDENTIAL_RECOVERY.md) |

The demo operator password is published deliberately, on the login page and in this
repository. Publishing it is safe because the role is the boundary: an operator reads
everything and changes nothing.

## Roadmap

Phases 1 through 6 are complete. Later phases are listed because they are planned, not because they exist.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Payments, webhooks, ledger, dashboard, tests, CI | ✅ Complete |
| 2 | Public deployment, live webhook registration, three clients, i18n, accessibility | ✅ Complete |
| 3 | Authentication, roles, audit log, admin console with live presence | ✅ Complete |
| 4 | Refunds (four-eyes rule, withdrawal, refund webhook) and account management | ✅ Complete |
| 5 | Payments, Transactions and Customers ledger pages; operator sign-in and audit trail on the Vue and Svelte clients | ✅ Complete |
| 6 | Operational visibility: structured logging, readiness endpoint, alerting | ✅ Complete |
| 7 | Activity events in MongoDB | Planned |
| 8 | Infrastructure as code, container deployment | ✅ Container and Kubernetes manifests shipped |
| 9 | Solidity settlement experiment, React Native client | Exploratory (Go service shipped early — see the reconciler) |

Reserved directories exist for the later phases and contain no implementation. They are
placeholders for planned work, not stubs of missing work.

## Running it locally

Full detail in [docs/runbooks/LOCAL_DEVELOPMENT.md](docs/runbooks/LOCAL_DEVELOPMENT.md).

```bash
docker compose -f infrastructure/docker/compose.yaml up -d postgres
```

```bash
cd apps/api && npm install && npm run migrate && npm run dev
```

```bash
cd apps/web && npm install && npm run dev
```

```bash
cd apps/web-vue && npm install && npm run dev     # Vue client on http://localhost:3001
```

```bash
cd apps/web-svelte && npm install && npm run dev  # Svelte client on http://localhost:3002
```

Copy `.env.example` to `.env` and fill in Stripe test keys. Use a **restricted** test key
(`rk_test_`) with Checkout write access rather than a full secret key — the reasoning is in
[ADR 0003](docs/decisions/0003-restrict-the-stripe-key-and-keep-it-server-side.md).

## Tests

```bash
cd apps/api && npm run test:unit
```

```bash
cd apps/api && npm run test:integration
```

```bash
cd apps/web && npm run test:e2e
```

```bash
node scripts/production-smoke.mjs
```

```bash
node scripts/load-test.mjs
```

Integration tests need PostgreSQL running, and the end-to-end suite needs staff accounts
seeded, which the pipeline does for itself:

```bash
cd apps/api && ADMIN_PASSWORD='choose-your-own' npm run seed:staff
```

The seed reads both accounts back and verifies their passwords against the real verifier
before reporting success — writing a hash proves a row exists, not that anyone can sign in
with it.

End-to-end tests build and start both servers themselves.

## Project structure

```text
apps/api           Fastify API — health, metrics, transactions, payments, webhooks,
                   auth (scrypt, sessions, rate limiting) and the guarded admin surface
apps/web           Next.js dashboard and checkout proxy
apps/web-vue       Vue 3 client — same API, Composition API + Pinia + Zod + Vitest
apps/web-svelte    Svelte 5 client — same API, runes + Zod + Vitest
packages/api-contract  Shared Zod description of the API, used by both SPA clients
database/postgres  Migrations and demo seed data
docs/              Architecture, decisions, quality strategy, runbooks, case study
infrastructure/    Docker compose for local PostgreSQL
.github/workflows  CI pipeline
```

Directories for later phases (`apps/mobile`, `services/`, `contracts/`, `database/mongodb`)
are reserved and empty.

## Licence

MIT. Sandbox demonstration project; not affiliated with Stripe.
