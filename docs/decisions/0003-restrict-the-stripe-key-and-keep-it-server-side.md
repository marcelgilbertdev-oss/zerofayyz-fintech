# 3. Use a restricted Stripe key, held only on the server

**Status:** Accepted · **Date:** 2026-08-19

## Context

Creating a Checkout Session requires a Stripe secret key. A standard test secret key
(`sk_test_`) can do everything the account can do: read customers, issue refunds, create
charges. This prototype needs exactly one capability — writing Checkout Sessions.

Separately, the browser needed a way to start a checkout without holding any key at all.

## Decision

Use a **restricted key** (`rk_test_`) scoped to Checkout write access. The browser calls a
Next.js route handler, which calls the API server-side; no key and no API URL is exposed to
the client.

## Consequences

A leaked key from this deployment can create Checkout Sessions and nothing else. It cannot
read customer records or move money elsewhere in the account. The blast radius is bounded by
the key's own scope rather than by our confidence that the key will not leak.

The cost is a second hop for every checkout and one more place a request can fail, which the
end-to-end test covers by asserting the failure surfaces in the UI rather than leaving the
button spinning.

The same reasoning drives the webhook: it verifies signatures against the unparsed request
body, so an unsigned POST to the endpoint cannot write to the ledger.
