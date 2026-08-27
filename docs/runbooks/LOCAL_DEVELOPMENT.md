# Local Development Runbook

## Prerequisites

- Node.js 20 or newer
- npm
- Docker Desktop
- Stripe CLI (`brew install stripe/stripe-cli/stripe`) — only for the webhook walkthrough

## 1. Start PostgreSQL

From the project root:

```bash
docker compose -f infrastructure/docker/compose.yaml up -d postgres
```

Check it is healthy:

```bash
docker compose -f infrastructure/docker/compose.yaml ps
```

## 2. Apply migrations

From `apps/api`:

```bash
npm install && npm run migrate
```

The runner applies every unapplied file in `database/postgres/migrations` in order and
records it in `schema_migrations`. It is safe to run repeatedly.

> The compose file also mounts the migrations into the image's init directory, but that only
> runs on an empty data directory. Do not rely on it — see
> [ADR 0004](../decisions/0004-run-migrations-with-an-explicit-runner.md).

## 3. Load demo data

From the project root:

```bash
docker exec -i zerofayyz-fintech-postgres psql -U zerofayyz_fintech -d zerofayyz_fintech -f /dev/stdin < database/postgres/seeds/001_demo_data.sql
```

Safe to re-run; every insert is `ON CONFLICT DO NOTHING`.

## 4. Configure the environment

```bash
cp .env.example .env
```

Fill in a **restricted** Stripe test key (`rk_test_`) with Checkout write access. Create one
at Stripe Dashboard → Developers → API keys → Restricted keys, in test mode.

Leave `STRIPE_WEBHOOK_SECRET` alone for now; step 7 provides it.

## 5. Start the API

From `apps/api`:

```bash
npm run dev
```

Listens on `http://127.0.0.1:4000`. Check it:

```bash
curl -s http://127.0.0.1:4000/api/v1/health
```

## 6. Start the dashboard

From `apps/web`:

```bash
npm install && npm run dev
```

Listens on `http://127.0.0.1:3000`.

The dashboard should show API service and PostgreSQL as Operational, Stripe as Configured if
you added a key, and the recent-transactions table populated from the seed data.

## 7. Forward webhooks

The webhook needs a signing secret, and Stripe needs a way to reach your machine. The CLI
provides both:

```bash
stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe
```

It prints a secret beginning `whsec_`. Put that in `.env` as `STRIPE_WEBHOOK_SECRET` and
restart the API. Leave `stripe listen` running.

## 8. Walk the payment path

1. Click **+ Test payment** on the dashboard
2. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode
3. You are returned to the dashboard with a success banner
4. `stripe listen` logs `checkout.session.completed`
5. Refresh — the payment reads **Succeeded**, and gross volume and the webhook event count
   have both increased

Until you have seen step 5 happen, the feature is written but not proven.

To confirm idempotency, resend the same event:

```bash
stripe events resend <event_id>
```

Nothing should change: no new transaction row, no new audit entry, no altered totals.

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

The business rules, written in Gherkin and executed by Cucumber:

```bash
cd apps/web && npm run test:bdd
```

Integration tests need PostgreSQL up; they truncate and reseed the tables they use, so do not
point them at a database whose contents you care about. End-to-end tests build and start both
servers themselves.

`test:bdd` also owns its whole lifecycle — it seeds the database, rebuilds and starts the API
with a throwaway Stripe key and webhook secret, starts the built dashboard, runs every feature
strictly, then shuts down what it started. Two things to know:

- **It needs PostgreSQL up**, like the integration tests, and it reseeds demo data.
- **If a server is already listening on :4000 without a webhook secret** — one left over from
  the e2e suite, say — it stops with that exact message rather than failing two scenarios
  with a confusing 503. Stop the stale server and re-run.
- **Cucumber supports LTS Node lines only.** On an odd-numbered Node it runs the Cucumber
  child under a Homebrew `node@22` keg automatically, or tells you to install one.

## Stop everything

Stop the Node processes with `Control-C`. Then, from the project root:

```bash
docker compose -f infrastructure/docker/compose.yaml stop postgres
```

Use `down -v` instead of `stop` only if you want the data destroyed and the schema rebuilt
from scratch.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Health shows PostgreSQL unavailable | Container not running, or `DATABASE_URL` points elsewhere |
| Checkout button returns "not configured" | `STRIPE_API_KEY` missing from `.env` |
| Webhook returns 503 | `STRIPE_WEBHOOK_SECRET` missing; take it from `stripe listen` |
| Webhook returns 400 | Signature mismatch — the secret does not match the running listener |
| Migration fails with a missing column | A migration was added after the container was created; run `npm run migrate` |
| Buttons do nothing in the browser | Dev-server origin mismatch; use the same hostname the server started on |
| CI fails on `npm ci` with "Missing: @emnapi/... from lock file" | A macOS `npm install` pruned Linux-only optional dependencies from the lock. Run `npm run relock` in `apps/web`, then `npm run verify:lock` to prove it before pushing, and commit the result |

## After adding a web dependency

`npm install` on macOS rewrites `package-lock.json` without the Linux-only
optional dependencies that Next's toolchain needs, so `npm ci` then fails on the
CI runner while everything works locally. After adding or upgrading anything in
`apps/web`:

```bash
cd apps/web && npm run relock
```

Then confirm the result actually satisfies Linux — this failure has reached CI three
times, and every one of them was avoidable from a laptop:

```bash
cd apps/web && npm run verify:lock
```

That runs the exact `npm ci` CI runs, inside a Linux container, against nothing but the
two files that matter. It prints `added N packages` on success and the same
`Missing: ... from lock file` error on failure — thirty seconds locally instead of a
red pipeline.

That does a full fresh resolve, which is the only reliable way to get every
platform's variants into the lock. Commit the regenerated lockfile.
