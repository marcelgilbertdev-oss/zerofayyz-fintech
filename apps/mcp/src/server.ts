#!/usr/bin/env -S npx tsx
/**
 * ZEROFAYYZ FINTECH — QA MCP server.
 *
 * Exposes the platform's quality surface over the Model Context Protocol, so an
 * agent (Claude Code, Claude Desktop, or a CI job) can run the suites, check
 * the deployed API against the shared contract, prove webhook idempotency and
 * read the ledger — without a human translating each of those into a shell
 * command first.
 *
 * Transport is stdio: the client owns the process lifetime, and nothing is
 * listening on a port. An HTTP transport exists in the SDK and is the wrong
 * default here — a QA tool that can run test suites should not be reachable
 * from the network by accident.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { ApiClient } from "./api-client.js";
import { loadConfig, type McpConfig } from "./config.js";
import { checkContractDrift } from "./tools/contract-drift.js";
import {
  LEDGER_RESOURCES,
  isLedgerResource,
  queryLedger,
  type LedgerResource,
} from "./tools/ledger.js";
import { SUITES, isSuiteName, runSuite, type SuiteName } from "./tools/suites.js";
import { replayWebhook } from "./tools/webhook-replay.js";

/** Every tool returns JSON text plus structured content, so both a model and a program can read it. */
function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function createServer(
  config: McpConfig = loadConfig(),
  client: ApiClient = new ApiClient(config),
): McpServer {
  const server = new McpServer({
    name: "zerofayyz-fintech-qa",
    version: "0.1.0",
  });

  server.registerTool(
    "get_health",
    {
      title: "Platform health",
      description:
        "Read the deployed API's health endpoint: real database latency, and " +
        "whether Stripe, the webhook secret and client origins are configured.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await client.request("/api/v1/health");
      return jsonResult(result);
    },
  );

  server.registerTool(
    "check_contract_drift",
    {
      title: "Check contract drift",
      description:
        "Validate live API responses against the shared Zod contract. Reports " +
        "field-level drift between what the deployed API returns and what the " +
        "clients were compiled against. This is the check that would otherwise " +
        "only fire in a user's browser.",
      inputSchema: z.object({}),
    },
    async () => {
      const report = await checkContractDrift(client);
      return jsonResult(report);
    },
  );

  server.registerTool(
    "replay_webhook",
    {
      title: "Replay a webhook event",
      description:
        "Deliver the same signed Stripe event more than once and report whether " +
        "the platform stayed idempotent: every delivery accepted, the effect " +
        "recorded at most once. Requires STRIPE_WEBHOOK_SECRET.",
      inputSchema: z.object({
        attempts: z
          .number()
          .int()
          .min(2)
          .max(5)
          .default(2)
          .describe("How many identical deliveries to send."),
      }),
    },
    async ({ attempts }) => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const report = await replayWebhook(client, {
        secret: config.webhookSecret,
        // Unique per run so a replay probe never collides with a previous one —
        // a reused id would be suppressed by the very constraint under test and
        // report a false pass.
        eventId: `evt_mcp_${nowSeconds}_${Math.random().toString(36).slice(2, 10)}`,
        nowSeconds,
        attempts,
      });
      return jsonResult(report);
    },
  );

  server.registerTool(
    "query_ledger",
    {
      title: "Query the ledger",
      description:
        "Read payments, transactions, customers, recorded events or the audit " +
        "trail, so a test can assert on platform state rather than on status " +
        "codes. Read-only.",
      inputSchema: z.object({
        resource: z
          .enum(
            Object.keys(LEDGER_RESOURCES) as [LedgerResource, ...LedgerResource[]],
          )
          .describe("Which ledger resource to read."),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        status: z.string().optional().describe("Filter payments by status."),
      }),
    },
    async ({ resource, limit, offset, status }) => {
      if (!isLedgerResource(resource)) {
        return errorResult(`Unknown ledger resource: ${resource}`);
      }

      const result = await queryLedger(client, {
        resource,
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "list_test_suites",
    {
      title: "List runnable test suites",
      description:
        "The allowlisted suites this server can run, and which of them reach " +
        "the deployed platform.",
      inputSchema: z.object({}),
    },
    async () =>
      jsonResult(
        Object.entries(SUITES).map(([name, definition]) => ({
          suite: name,
          description: definition.description,
          touchesProduction: definition.touchesProduction,
        })),
      ),
  );

  server.registerTool(
    "run_test_suite",
    {
      title: "Run a test suite",
      description:
        "Run one allowlisted suite and report pass/fail, exit code, duration " +
        "and the tail of its output. Takes a suite name, never a command.",
      inputSchema: z.object({
        suite: z
          .enum(Object.keys(SUITES) as [SuiteName, ...SuiteName[]])
          .describe("Which allowlisted suite to run."),
        timeoutMs: z.number().int().min(10_000).max(1_800_000).optional(),
      }),
    },
    async ({ suite, timeoutMs }) => {
      if (!isSuiteName(suite)) {
        return errorResult(`Unknown suite: ${suite}`);
      }

      const run = await runSuite(suite, {
        repoRoot: config.repoRoot,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
      return jsonResult(run);
    },
  );

  return server;
}

// Only start a transport when run as a program. Importing this module in a test
// must not attach to stdio, or the test runner and the server fight over stdin.
// Compared as resolved URLs, not basenames — a basename match would also fire
// inside any importer whose own entry file happened to be called server.ts.
const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  serveStdio(() => createServer());
}
