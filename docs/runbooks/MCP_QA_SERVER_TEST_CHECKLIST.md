# MCP QA Server — founder test checklist

First-install verification for `apps/mcp`, done by a person, from the outside.
About 15 minutes. Every step says what PASS looks like; anything else is a FAIL
worth reporting, not working around.

Machine checks (23 unit tests, typecheck, protocol handshake, a live
contract-drift call against production) already passed on 2026-08-27. This
checklist is the part only a person can do: prove the server works from a real
Claude client on this machine.

---

## 0 · Preconditions (30 seconds)

```bash
cd "/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM/apps/mcp" && npm run typecheck && node scripts/handshake-check.mjs
```

**PASS:** `MCP handshake OK (6 tools)`.
If this fails, stop — nothing downstream can work; report the output.

## 1 · Register the server

The repo ships a project-scoped [`.mcp.json`](../../.mcp.json), so there is
nothing to install and no command to run. Paths in it are **relative** — Claude
Code launches a stdio server with the project root as its working directory, so
the config is portable to any machine that clones the repo.

The credentials in it are the public demo operator (`demo@zerofayyz.test`),
printed on the platform's own login page by design: reads everything, changes
nothing. Committing them is deliberate, not an oversight.

**Do this:** open `/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM` as
the project in Claude Code (a new session, that folder — not `~/gabriel`).
Claude Code will prompt to approve the project's MCP server the first time.
Approve it.

> The `claude mcp add` CLI command works too, but only if the standalone
> `claude` CLI is installed. It is **not** installed on this machine — Claude
> Code runs inside Claude.app here — which is why `.mcp.json` is the path.

## 2 · Drive it from a fresh session

In that same session (the one where you approved the server), ask these in
order — plain English is the point; you are
testing that an agent can operate the platform's QA surface without you
translating:

| # | Ask Claude | PASS looks like |
|---|---|---|
| 2a | "What tools does zerofayyz-qa expose?" | Six tools, each with a description |
| 2b | "Check the platform's health" | `operational`, a real database latency number, Stripe/webhook `configured` |
| 2c | "Check the platform for contract drift" | **All 4 verified endpoints match the shared contract** — health, metrics, transactions *and* admin/audit-logs, the last unlocked by the credentials in `.mcp.json` (CI still skips it) |
| 2d | "Show me the last 5 transactions in the ledger" | Yen rows from the live ledger |
| 2e | "List the test suites you can run" | 7 suites; only `production-smoke` flagged as touching production |
| 2f | "Run the vue-unit test suite" | 40 tests pass, exit code 0, duration reported |
| 2g | "Try to replay a webhook" | A clean **"STRIPE_WEBHOOK_SECRET is not configured"** report — *not* an error. The graceful-refusal path is itself under test here |

2g is correct behaviour on this Mac: the webhook secret lives only in Render.
Do not copy it locally to force a full replay against production — a real
replay records probe events in the live demo ledger. The full replay path is
covered by unit tests; run it for real only against a local API if ever needed.

## 3 · Optional: production smoke through the agent (~1 min, read-only)

Ask: **"Run the production-smoke suite."**
**PASS:** 28/28 checks against the deployed platform. This is the same suite as
`node scripts/production-smoke.mjs` — the point is proving an agent can run it.

## 4 · Optional: Claude Desktop (second client, ~3 min)

In `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "zerofayyz-qa": {
      "command": "npx",
      "args": ["tsx", "/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM/apps/mcp/src/server.ts"],
      "env": {
        "MCP_REPO_ROOT": "/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM",
        "MCP_OPERATOR_EMAIL": "demo@zerofayyz.test",
        "MCP_OPERATOR_PASSWORD": "view-the-ledger"
      }
    }
  }
}
```

Restart Desktop, look for the tools icon, repeat 2b.
**PASS:** same health answer from a second client — proves the server is
client-agnostic, not tuned to one harness.

## If something fails

- **Server won't connect (step 1/2):** run the step-0 handshake in a terminal.
  If it passes there but not in Claude, the project is wrong — the session must
  have this repo as its project folder, since `.mcp.json` is project-scoped.
- **2f errors about paths:** the server's working directory was not the repo
  root. Add `"MCP_REPO_ROOT": "/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM"`
  to the `env` block in `.mcp.json` to pin it explicitly.
- **2c shows drift:** read *which field*. If production genuinely drifted, that
  is the tool doing its job — do not shoot the messenger.

## When done

Report the per-step results (even the boring passes). The install ledger entry
`INS-ZEROFAYYZ-FINTECH-QA-MCP-SERVER` gets its founder-verified line only after
this checklist has been run by a person.

---

## Run log

### 2026-08-27 — first run, with Marcel · ALL STEPS PASS

Every step above passed; full write-up in the
[acceptance test human result log](MANUAL_ACCEPTANCE_TEST.md#human-result-log).

Two things this first run taught, folded back into the doc above:

1. **Step 2d found a real defect** — `limit` was ignored by `/api/v1/transactions`
   (failure #17). Both ends fixed and deployed; the endpoint now pages, so 2d's
   PASS condition is worth tightening from "yen rows" to "*the number of rows you
   asked for*, and `meta.limit` echoing your request back."
2. **Step 2g's precondition is worth checking, not assuming.** Confirm
   `STRIPE_WEBHOOK_SECRET` is absent from both the shell environment and
   `.env.local` before running it. If it were set, the "graceful refusal" step
   would instead fire a real replay into the live demo ledger.
