# The platform's rules, in plain language

These files state what this payments platform promises, in a form a
non-engineer can read and dispute — and then execute as tests.

```bash
cd apps/web && npm run test:bdd
```

---

## What you are looking at

Each `.feature` file is written in **Gherkin**: `Given` a starting state,
`When` something happens, `Then` this must be true. Every line is bound to a
function in `steps/` that does the real work — calling the API, driving a
browser, reading the ledger.

The point is not the syntax. It is that the rule and the test are the same
artefact. Anyone can read this and say whether it is the rule they wanted:

```gherkin
Scenario: The person who requested a refund cannot approve it
  When the admin requests a refund on a succeeded payment because "Duplicate charge"
  And the admin tries to approve that refund request
  Then the approval is refused with status 403
  And that refund request is still pending
```

## The five features

| File | The rule it states |
| --- | --- |
| `four-eyes-refunds.feature` | Money leaves only when two different people agree |
| `sign-in-discretion.feature` | A failed sign-in reveals nothing — wrong password, no such account, and disabled account are byte-identical |
| `yen-zero-decimal.feature` | One minor unit is one yen; no fractions, anywhere |
| `webhook-idempotency.feature` | The same event delivered twice is accepted twice and recorded once |
| `ledger-pagination.feature` | `limit` and `offset` are honoured — regression coverage for a real defect |

## How it is laid out

| Path | What it holds |
| --- | --- |
| `*.feature` | The rules. Start here. |
| `steps/api.steps.ts` | Step definitions that talk to the API |
| `steps/ui.steps.ts` | Step definitions that drive a browser |
| `support/world.ts` | All I/O — sign-in, HTTP, browser lifecycle — so steps stay one or two lines |
| `support/hooks.ts` | Setup and cleanup between scenarios |

Steps are deliberately thin. A feature file only reads as a specification if
the code beneath it is boring.

## Two scenarios are narrower than they look, on purpose

**Refund approval is never fully proved.** Approving calls Stripe's real API,
and this suite runs a dummy key that cannot reach Stripe — which is also the
guarantee no test can move money. So the four-eyes feature proves the
*refusal* and proves a different person can decide via rejection.

**Webhook replays target a real seeded payment.** The handler deliberately
records nothing for events it cannot tie to a local payment, so a fabricated
one would silently prove nothing.

A feature file is a public promise. It must claim only what the environment
can honestly observe — see
[ADR 0012](../../../docs/decisions/0012-state-payment-rules-in-gherkin.md).

## Housekeeping the suite does for you

Refund scenarios raise real pending requests, and the schema allows one
pending request per payment — so hooks clear the queue before *and* after,
and the disabled-account scenario re-enables the operator even if it fails
mid-way. Run it as often as you like; it leaves the database as it found it.
