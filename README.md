# ZEROFAYYZ FINTECH

## Cloud Payments & Operations Platform

[![CI](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech/actions/workflows/ci.yml/badge.svg)](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech/actions/workflows/ci.yml)

**Portfolio prototype — Stripe sandbox only. No real funds move.**

A payments and operations platform: hosted Stripe Checkout, signature-verified webhooks, an
append-only transaction ledger in PostgreSQL, and a server-rendered operations dashboard.
Built to be read as much as run — the decisions are documented, the tests are structured
around how payment systems actually fail, and everything is gated by CI.

- **Live demo:** **https://zerofayyz-fintech.vercel.app**
- **Architecture:** [docs/architecture/SYSTEM_OVERVIEW.md](docs/architecture/SYSTEM_OVERVIEW.md)
- **Quality strategy:** [docs/QUALITY_STRATEGY.md](docs/QUALITY_STRATEGY.md)
- **Decision records:** [docs/decisions/](docs/decisions/)
- **How it works (full walkthrough):** [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)
- **Roadmap:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Case study (non-technical):** [docs/portfolio/CASE_STUDY.md](docs/portfolio/CASE_STUDY.md)

## Stack

TypeScript throughout, ESM, Node 20+.

| Layer | Choice |
| --- | --- |
| API | Fastify 5, JSON-schema validated responses |
| Web | Next.js 16, React 19, server components, Tailwind |
| Database | PostgreSQL 18, `pg`, hand-written SQL |
| Payments | Stripe 22, hosted Checkout, signed webhooks |
| Tests | `node --test` for unit and integration, Playwright for end-to-end |
| CI | GitHub Actions — typecheck, lint, unit, integration, end-to-end |

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
- 31 automated tests across three layers, all gated in CI, plus a nine-check smoke suite that verifies the live deployment from outside

## Roadmap

Phase 1 is complete. Later phases are listed because they are planned, not because they exist.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Payments, webhooks, ledger, dashboard, tests, CI | ✅ Complete |
| 2 | Public deployment and live webhook registration | 🔜 Next |
| 3 | Authentication and an admin view | Planned |
| 4 | MongoDB-backed activity events | Planned |
| 5 | Infrastructure as code, container deployment | Planned |
| 6 | Go service, Solidity settlement experiment, React Native client | Exploratory |

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

Integration tests need PostgreSQL running. End-to-end tests build and start both servers
themselves.

## Project structure

```text
apps/api           Fastify API — health, metrics, transactions, payments, webhooks
apps/web           Next.js dashboard and checkout proxy
database/postgres  Migrations and demo seed data
docs/              Architecture, decisions, quality strategy, runbooks, case study
infrastructure/    Docker compose for local PostgreSQL
.github/workflows  CI pipeline
```

Directories for later phases (`apps/mobile`, `services/`, `contracts/`, `database/mongodb`)
are reserved and empty.

## Licence

MIT. Sandbox demonstration project; not affiliated with Stripe.
