# 11. Expose the QA surface over MCP, not the product surface

Date: 2026-08-27

## Status

Accepted.

## Context

Two of this platform's most valuable checks could only run in the wrong place.

**Contract drift.** Each client compiles against a *copy* of the API's types
(ADR 6). Nothing at build time proves the deployed API still matches, so the Zod
contract validates at runtime — at the browser's edge, after a user has already
loaded the page. The check existed; its timing was wrong.

**Webhook idempotency.** The API relies on a unique constraint on
`provider_event_id` with `ON CONFLICT DO NOTHING` rather than application
branching, because a database guarantee holds under concurrency and an
`if (alreadySeen)` does not. But a test that delivers an event once cannot
distinguish a working idempotency key from a missing one.

Both are things a person could check by hand and therefore rarely did.

## Decision

Expose the platform's **quality surface** — not its product surface — over the
Model Context Protocol, as `apps/mcp`.

Six tools: `get_health`, `check_contract_drift`, `replay_webhook`,
`query_ledger`, `list_test_suites`, `run_test_suite`.

Three constraints shape the design.

**Stdio, not HTTP.** The client owns the process lifetime and nothing listens on
a port. The SDK offers an HTTP transport; a tool that can run test suites should
not be reachable from the network by accident.

**Suites are named, never commanded.** `run_test_suite` takes a key into a fixed
allowlist and spawns with `shell: false`. A "run a command for me" tool is one
confused instruction away from running anything at all. A test asserts no
definition contains a shell metacharacter, and that the name check rejects
inherited prototype keys — `isSuiteName("constructor")` returns true under a
membership check written with `in`.

**Reads cannot mutate.** Ledger resources are a fixed map, and the server signs
in as the demo operator, which reads everything and changes nothing. Two
independent reasons, so neither has to be the only one.

## Consequences

Contract drift is now a command and a CI gate rather than a defect a user finds.
Webhook idempotency is asserted by delivering the same signed event twice and
checking the recorded-event count moved by at most one, which is the only way to
observe the guarantee from outside.

The MCP job in CI runs typecheck, 24 unit tests, and a **protocol handshake
check**. The handshake is the important one: every tool function can pass its own
tests while the server fails to register them or fails to speak MCP at all —
a green suite and zero working tools. That is the same shape as the webhook
handler with nineteen passing unit tests that had never once worked, and it is
why the gate asserts against a real `initialize` rather than against a mock.

The first live run reported one of four endpoints as drifted. It had not
drifted; the audit-log endpoint simply had no operator credentials, and a
configuration gap was being reported as a contract failure. Reporting an
unconfigured capability as a red line is how a quality tool trains people to
ignore it. `skipped` is now distinct from `drifted`, held by two regression
tests.

We are not exposing the product surface — no checkout creation, no refund
approval. An agent that can take payments is a different risk conversation, and
this server exists to test the platform, not to operate it.
