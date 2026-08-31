# Quality Strategy

How this platform is tested, what each layer is responsible for, and what is deliberately
left untested.

## The principle

A green test suite is not evidence that a feature works. It is evidence that the things the
suite actually exercises still behave as they did. The distance between those two statements
is where defects live, and this project has a concrete example of it — see
[The defect that justified this strategy](#the-defect-that-justified-this-strategy) below.

Each layer therefore exists to catch a class of failure the layer beneath it structurally
cannot see.

## The layers

| Layer | Count | Runs against | Catches |
| --- | --- | --- | --- |
| Unit | 82 | Stubbed database and Stripe | Branching, mapping, status logic, guard clauses, password hashing, cookie attributes, rate-limit arithmetic |
| Integration | 52 | Real PostgreSQL | SQL validity, constraints, triggers, idempotency, migrations, authentication and authorisation, row-level security |
| End-to-end | 65 | Built servers in a real browser | Rendering, hydration, sign-in, role separation, both locales, WCAG AA |
| **BDD (Gherkin)** | **13 scenarios** | The whole stack, seeded and booted | Whether the platform's *business rules* still hold — stated in language a non-engineer can dispute |
| Load | 3 scenarios | The deployed API under concurrency | Latency regressions, errors under load |
| Vue client unit | 40 | jsdom, fetch mocked at the network seam | Contract validation, store state, sign-in and audit-trail flow, partial failure, rendered output |
| Svelte client unit | 29 | jsdom, fetch mocked at the network seam | The same behavioural contract as the Vue suite — if they disagree, a client has drifted |
| **QA MCP server** | **31** | Its own tools, plus a live protocol handshake | That an agent can drive the suites, and that contract drift and webhook idempotency are checkable on demand |
| Production smoke | 28 | The deployed system, from outside, no credentials | That what *shipped* runs — including checks that only the newest build can satisfy |

Total wall-clock for all local suites: under thirty seconds.

### Visual regression is scoped to what does not move

Two layout defects reached production this week and neither failed a test: a
password field overflowed its column and slid under the card beside it, and the
header pushed the document 124px wider than a phone viewport. Every functional
assertion passed, because every functional assertion asks whether something is
*present*.

Screenshot comparison closes that gap — but only where the content is
deterministic. The first attempt captured the dashboard full-page and failed
in CI immediately: 1488px against 1422px, because a developer's database holds
more payments than a freshly seeded one and the row count changes the page's
geometry. Masking the figures does not help; the height is wrong before any
pixel inside it is compared.

So the suite covers the chrome — the sign-in page, the sidebar, the navigation
drawer — at desktop and phone width, and leaves data-driven pages to the
functional tests. That is where both real defects actually were. A visual suite
that fails whenever the ledger moves is one people learn to ignore, and an
ignored suite is worse than none: it is a green tick that means nothing.

Baselines are per-renderer, so the Linux set is recorded inside the same
container image CI runs, and the suite is opt-in (`PLAYWRIGHT_VISUAL=1`) so it
never runs on a mismatched renderer where every failure would be noise.

### Authorisation is tested by making the refused request

The auth suites are worth calling out because of *how* they assert. A guard written beside a
route is not a guard until something walks through the wrong door, so the tests do exactly
that: an anonymous caller gets `401` on all four privileged routes, a viewer gets `403` on
all of them, and an operator reads the audit log and is refused everything else. Those
refusals are the assertions.

The same principle covers the append-only audit log — the test tries to `UPDATE` and
`DELETE` rows and asserts both are rejected — and revocation, where an ended session's
unchanged, unexpired cookie must fail on the next request.

### The smoke suite must be able to tell builds apart

A production smoke suite exists to notice a failed deploy. This one once could not: every
check matched text the previous build also contained, so it stayed green while Vercel served
a stale dashboard for two hours. Its Phase 3 checks assert content that exists **only** in
the newest build. A check both builds satisfy is not a deployment check.

### Unit — `apps/api/src/**/*.test.ts`

Fast, hermetic, no I/O. The database and the Stripe gateway are both injected, so these
tests can drive every branch cheaply, including ones that are awkward to reach for real: an
unconfigured Stripe key, a forged signature, an event whose `client_reference_id` is not a
UUID.

The webhook's four-way status mapping is covered here — a paid `completed` event, an unpaid
one, `async_payment_failed`, `expired` — because those are pure decisions about which status
a given event implies.

**Structural blind spot:** they never execute SQL. A statement can be syntactically invalid,
reference a column that does not exist, or fail type inference, and every one of these tests
still passes.

### Integration — `apps/api/src/**/*.integration-test.ts`

Runs against a real PostgreSQL instance, seeded and truncated per run. This is where the SQL
is actually executed and where the constraints do their work.

The load-bearing test delivers the same webhook event twice and asserts the transaction and
audit-log counts do not move, then delivers a different event id and asserts they do. That
is the idempotency guarantee stated in
[ADR 0002](decisions/0002-key-webhook-idempotency-on-provider-event-id.md), tested as
behaviour rather than trusted as a code comment.

The migration runner is also tested for idempotency here: a second run must apply nothing.

### End-to-end — `apps/web/e2e/`

Playwright against compiled output — `next build && next start`, not `next dev` — because
the dev server behaves differently enough to hide real problems, and because the built
artifact is what deploys.

These cover what the other layers cannot: that the page renders, that React hydrates, that a
click reaches a handler, and that a failure is visible to a human rather than swallowed.

One test asserts a negative: the retired placeholder figures (`$48,920`, `1,284`) must never
reappear on the page. If someone reintroduces hardcoded numbers where live data belongs, the
build fails. Tests that assert an old bug stays fixed are worth more than their line count
suggests.

### BDD — [`apps/web/features/`](../apps/web/features/README.md)

Cucumber 13 executing Gherkin feature files against the whole stack. Five features state the
platform's rules in plain language: four-eyes refund approval, sign-in failures that reveal
nothing, zero-decimal yen, webhook idempotency, and pagination.

Every one of those was already covered by the layers above. The difference is *who can read
it*: a `.feature` file is a specification a product manager or compliance reviewer can dispute
without reading TypeScript, and it executes. That is the whole argument for the layer, and the
reason to keep it small — thirteen scenarios covering rules worth publishing, not a
translation of the entire suite into Gherkin.

`npm run test:bdd` owns the lifecycle: seed, boot the API with a throwaway Stripe key and
webhook secret, boot the built dashboard, run strictly, tear down. It rebuilds the API every
run, because its first run failed against a stale `dist/` and a stale build is
indistinguishable from a regression from outside.

Two scenarios are deliberately narrower than they could be. Approving a refund calls Stripe's
real API, which the suite's dummy key cannot do, so the four-eyes feature proves the *refusal*
and decision-by-another via rejection rather than pretending to prove an approval. And the
webhook handler records nothing for events it cannot tie to a local payment, so replays
deliver a signed `checkout.session.completed` for a genuinely seeded payment. A feature file
is a public promise; it must only claim what the environment can honestly observe.

Reasoning: [ADR 0012](decisions/0012-state-payment-rules-in-gherkin.md).

### QA surface over MCP — `apps/mcp/`

An MCP server exposing the quality surface — run the allowlisted suites, validate live API
responses against the shared contract, replay a signed webhook, read the ledger. Two of its
tools moved checks that could previously only run in the wrong place: contract drift was
catchable only once a user had loaded the page, and webhook idempotency could not be observed
from outside at all.

The product surface is deliberately absent. An agent that can *operate* a payments system is a
different risk conversation from one that can *test* it. Reasoning:
[ADR 0011](decisions/0011-expose-the-qa-surface-over-mcp.md); details in
[apps/mcp/README.md](../apps/mcp/README.md).

## The defect that justified this strategy

The webhook handler shipped with nineteen passing unit tests and had **never once worked**.

`JSONB_BUILD_OBJECT` accepts `"any"`, so an uncast bind parameter has no inferable type and
PostgreSQL rejects the entire statement with `42P18: could not determine data type of
parameter $10`. Every real webhook delivery would have returned 500. The payment flow was
broken end to end.

No unit test could have found it, because every one of them stubs the database. The first
integration test written against real PostgreSQL found it in the first run.

The lesson is not "write more tests." It is that a test suite has a shape, and defects
collect in the places the shape does not reach. The commit is `29a7128`.

## What is deliberately not tested

Stated openly, because unstated gaps read as oversights:

- **Stripe's own behaviour.** Signature verification is stubbed in unit tests and the
  gateway is faked. Verifying that Stripe signs correctly is Stripe's job.
- **The live sandbox redirect.** Completing a payment on Stripe's hosted page requires real
  test keys and is covered by the manual charter below, not by automation. Automating a
  third party's hosted UI produces tests that break when they redesign it.
- **Capacity planning.** `scripts/load-test.mjs` asserts a latency and error-rate baseline
  under modest concurrency, which is the honest claim available on a single shared free
  instance. It is not a capacity model, and calling it one would be theatre.

  Current baseline at 10 concurrent, 120 requests per endpoint: p95 of 546ms (health),
  399ms (metrics), 319ms (transactions), zero errors. The script warms the instance first —
  the free tier sleeps, and measuring a 22-second cold start as latency would misreport it.

  It runs on a schedule and on demand rather than on every push: a failure on a normal
  commit would usually mean the instance was cold, not that the commit regressed.
- **Visual regression.** No baseline screenshots. The layout is not the thing under test.

## Manual and regression charter

Run before any deployment, and after any change to the payment path. This is the part no
automation covers, and it is short on purpose so that it actually gets run.

| # | Check | Expected |
| --- | --- | --- |
| 1 | Load the dashboard with the API stopped | Tiles read "Unavailable"; page still renders |
| 2 | Start the API with no Stripe key | Health shows "Awaiting test key"; checkout button returns a visible error |
| 3 | Configure a restricted test key, click "Test payment" | Redirect to Stripe Checkout |
| 4 | Pay with `4242 4242 4242 4242` | Return to dashboard; success banner shows |
| 5 | Wait for the webhook, refresh | Payment reads Succeeded; gross volume and event count both increase |
| 6 | Replay the event with `stripe events resend <id>` | No new row; counts unchanged |
| 7 | Abandon a checkout, let it expire | Payment reads Canceled |
| 8 | `POST /api/v1/webhooks/stripe` with no signature | `400`, nothing written |
| 9 | Open `/admin` signed out | Redirected to `/login` |
| 10 | Sign in as the demo operator | Audit log visible; no sessions or accounts panel |
| 11 | Sign in as an administrator, revoke another session | Row disappears; `admin.session.revoked` logged and attributed |
| 12 | Replay the revoked session's cookie | `401` — unchanged, unexpired, and refused |
| 13 | Six wrong passwords for one account | Five `401`, then `429` |

The full walkthrough, with a human result log and every defect found during development,
lives in [the manual acceptance charter](runbooks/MANUAL_ACCEPTANCE_TEST.md).

Steps 3 to 7 need Stripe test keys and `stripe listen --forward-to
localhost:4000/api/v1/webhooks/stripe`. See the
[local development runbook](runbooks/LOCAL_DEVELOPMENT.md).

## Gates

Nothing merges without the pipeline passing. `.github/workflows/ci.yml` runs ten jobs:

1. **API** — typecheck, unit tests, migrations against an empty database, integration tests
2. **Container** — builds the image, starts it, waits on its own healthcheck
3. **Reconciler** — the Go ledger reconciler's own suite
4. **Web** — lint, typecheck (application *and* the separately-scoped e2e project), build
5. **Vue client** — typecheck, unit tests, build
6. **Svelte client** — typecheck, unit tests, build
7. **MCP** — typecheck, unit tests, and a real protocol handshake against the running server
8. **BDD** — seeded database, built stack, every Gherkin feature run strictly
9. **Visual regression** — inside the renderer the baselines were recorded in
10. **End-to-end** — migrated database, demo data, seeded staff accounts, both servers built
    and started, Playwright

The web job typechecks through two project files on purpose. The application's `tsconfig`
excludes `e2e/`, because the Next build typechecks everything it includes and would follow a
Playwright spec's deliberate cross-package import into a package the deploy never installs —
which killed two production deploys before the split existed.

TypeScript runs in `strict` mode with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, so the compiler is a gate in its own right rather than a
formatting preference.

The end-to-end job depends on the first two, so a broken build never spends time starting
browsers. Playwright reports upload as artifacts on failure, because a red pipeline with no
evidence attached is a second debugging session rather than the end of the first.
