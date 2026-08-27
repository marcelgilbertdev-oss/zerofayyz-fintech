# QA MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes this platform's
**quality surface** — test runs, contract drift, webhook idempotency, ledger
reads and health — so an agent can drive testing directly instead of a human
translating each check into a shell command first.

Transport is **stdio**. The client owns the process; nothing listens on a port.
An HTTP transport exists in the SDK and is deliberately not used: a tool that
can run test suites should not be reachable from the network by accident.

---

## Why this exists

Two checks on this platform could only ever run in the wrong place:

- **Contract drift.** Every client compiles against a *copy* of the API's types.
  Nothing at build time proves the deployed API still matches. Zod catches drift
  at the browser's edge — but only once a user has already loaded the page.
  `check_contract_drift` moves that check into CI and onto a command.
- **Webhook idempotency.** Stripe delivers at least once, and the API relies on a
  unique constraint plus `ON CONFLICT DO NOTHING` rather than application
  branching. A test that delivers an event once cannot tell a working
  idempotency key from a missing one. `replay_webhook` delivers it twice.

The rest of the tools exist so an agent can act on what those two report.

---

## The tools

| Tool | What it does | Needs |
| --- | --- | --- |
| `get_health` | Deployed API health: real database latency, Stripe / webhook / origin configuration | — |
| `check_contract_drift` | Validates live responses against the shared Zod contract, naming the drifted field | — |
| `replay_webhook` | Delivers a signed Stripe event N times; asserts all accepted, effect recorded once | `STRIPE_WEBHOOK_SECRET` |
| `query_ledger` | Reads payments, transactions, customers, events or the audit trail | operator creds for audit logs |
| `list_test_suites` | The allowlisted suites, and which reach production | — |
| `run_test_suite` | Runs one allowlisted suite; reports pass/fail, exit code, duration, output tail | — |

### Read-only by construction

`query_ledger` cannot mutate the ledger, for two independent reasons:

1. The resources are a **fixed map**. There is no path an agent can supply.
2. The server signs in as the **demo operator**, which the platform grants
   read-everything / change-nothing.

### `run_test_suite` takes a name, never a command

Every runnable command is a fixed entry in an allowlist, spawned with
`shell: false`. There is no argument that turns this into arbitrary shell
execution — the failure mode of a "run a command for me" tool is that the model
is one confused instruction away from running anything at all.

A test asserts no suite definition contains a shell metacharacter, and that
`isSuiteName` rejects inherited prototype keys (`constructor`, `__proto__`) that
a membership check written with `in` would happily accept.

---

## Running it

```bash
cd apps/mcp
npm install
npm start          # stdio server
```

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_API_URL` | the deployed API | Platform API base URL |
| `MCP_REPO_ROOT` | `process.cwd()` | Repository root, for running suites |
| `MCP_TIMEOUT_MS` | `90000` | Per-request HTTP timeout |
| `MCP_OPERATOR_EMAIL` | — | Operator sign-in (audit-log reads) |
| `MCP_OPERATOR_PASSWORD` | — | Operator sign-in |
| `STRIPE_WEBHOOK_SECRET` | — | Required by `replay_webhook` |

A missing credential makes the affected tool report **"not configured"** rather
than fail. A quality tool that errors when a capability is simply switched off
teaches people to ignore it.

### Registering with Claude Code

```bash
claude mcp add zerofayyz-qa -- npx tsx "$PWD/apps/mcp/src/server.ts"
```

### Registering with Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zerofayyz-qa": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/apps/mcp/src/server.ts"],
      "env": {
        "MCP_REPO_ROOT": "/absolute/path/to/the/repo"
      }
    }
  }
}
```

Absolute paths are required — the client launches the process with an
unspecified working directory.

---

## Tests

```bash
npm test           # 23 unit tests
npm run typecheck
node scripts/handshake-check.mjs
```

First-install verification by a person (registration, live tool calls from a
real client): [docs/runbooks/MCP_QA_SERVER_TEST_CHECKLIST.md](../../docs/runbooks/MCP_QA_SERVER_TEST_CHECKLIST.md).

The handshake check is the one that matters most. Unit tests cannot catch the
failure specific to a protocol server: **every tool function can pass its own
tests while the server fails to register them or fails to speak MCP at all** —
a green suite and zero working tools. It completes a real `initialize`, lists
tools, and asserts each expected tool is present *and described* (a tool with no
description is invisible to a model choosing what to call, which makes it
functionally absent). It runs as a gate in CI.

### A defect this tool found in itself

The first live run against production reported **1 of 4 endpoints drifted**. It
had not drifted — the audit-log endpoint simply had no operator credentials
configured, and the tool was reporting a configuration gap as a contract
failure. That is precisely the cry-wolf behaviour this server's own comments
warn against: the first thing anyone learns about a report where one line is
always red is to stop reading it.

Fixed by separating `skipped` from `drifted`, with two regression tests holding
the distinction — one that a missing credential reads as skipped, one that a
genuine `ECONNREFUSED` still reads as drift.
