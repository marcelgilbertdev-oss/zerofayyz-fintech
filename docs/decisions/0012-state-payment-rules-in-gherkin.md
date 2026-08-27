# 12. State the payment rules in Gherkin, executed by Cucumber

Date: 2026-08-27

## Status

Accepted.

## Context

The platform's most important behaviours are business rules, not code shapes:
money leaves only when two different people agree; a failed sign-in reveals
nothing about why; one minor unit is one yen; the same webhook delivered twice
records once. Every one of them was already tested — but the tests read as
code, so the only people who could review whether the *rules* were right were
the people who wrote them.

That gap is what behaviour-driven development exists for, and it is why
payments companies run Cucumber: a `.feature` file is a specification a
product manager or compliance reviewer can read and dispute, and it executes.

The honest counter-argument is that Gherkin adds a translation layer between
the test and the code, and on a single-person project that layer has no second
reader yet. It earns its keep in exactly one case: when the rules themselves
are worth publishing. Ours are.

## Decision

A Cucumber suite (`@cucumber/cucumber` 13, the real runner — not a
Gherkin-flavoured wrapper) under `apps/web/features/`: five features, thirteen
scenarios, stating the platform's payment rules in plain language. Step
definitions stay one or two lines each; all I/O lives on the World. Browser
steps drive Playwright as a library; everything that can be asserted at the
API is asserted at the API, where failures are exact.

`npm run test:bdd` owns the whole lifecycle — seed, boot the API with a
throwaway Stripe key and webhook secret, boot the built dashboard, run
strictly, tear down — because half the value of a BDD suite evaporates the
moment running it needs a page of setup instructions. A tenth CI job runs it
on every push.

Two constraints shaped the scenarios:

**Only rules the sandbox can honestly observe.** Approving a refund calls
Stripe's real API, which a dummy key cannot do — so the four-eyes feature
proves the refusal (the requester cannot approve their own request, enforced
in the UPDATE's WHERE clause) and proves a *different* person can decide via
rejection, and does not pretend to prove a full approval.

**Events must be real to be recorded.** The webhook handler deliberately
records nothing for events it cannot tie to a local payment. The first draft
fabricated a payment intent and then wondered why the recorded-event count
never moved; the suite now replays a signed `checkout.session.completed` for a
genuinely seeded payment, which is also the more truthful scenario.

## Consequences

The rules are now artefacts. `features/four-eyes-refunds.feature` is something
a reviewer, an auditor, or a hiring panel can read in ninety seconds and know
exactly what the platform promises — then watch execute.

The suite found friction worth recording: the pagination feature is regression
coverage for the live limit/offset defect the QA MCP server caught on
2026-08-27, and its first run failed against a stale API build — which is why
the runner now rebuilds the API every time rather than trusting `dist/` to be
current.

Cucumber supports LTS Node lines only; the runner detects an odd-numbered Node
and runs the Cucumber child under a Homebrew LTS keg when one exists.
