#!/usr/bin/env node
/**
 * Protocol handshake check.
 *
 * Starts the QA MCP server over stdio, completes a real MCP initialize, lists
 * its tools, and asserts every expected tool is present with a description.
 *
 * This exists because the unit tests cannot catch the failure that matters
 * most here: every tool function can pass its own tests while the server fails
 * to register them, or fails to speak the protocol at all. That produces a
 * green suite and zero working tools — the same shape as the webhook handler
 * with nineteen passing tests that had never once worked.
 *
 * No network access and no credentials: it only lists tools, never calls one.
 *
 *   node scripts/handshake-check.mjs
 *
 * Exits non-zero on any failure, so it can gate a merge.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const TIMEOUT_MS = Number.parseInt(process.env.HANDSHAKE_TIMEOUT_MS ?? "120000", 10);

const EXPECTED_TOOLS = [
  "get_health",
  "check_contract_drift",
  "replay_webhook",
  "query_ledger",
  "list_test_suites",
  "run_test_suite",
];

const child = spawn("npx", ["tsx", "src/server.ts"], {
  cwd: APP_ROOT,
  shell: false,
  env: process.env,
});

let buffer = "";
let settled = false;

function finish(code, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.log(message);
  child.kill("SIGKILL");
  process.exit(code);
}

const timer = setTimeout(() => {
  finish(1, `FAIL  no handshake within ${TIMEOUT_MS}ms`);
}, TIMEOUT_MS);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("error", (error) => finish(1, `FAIL  could not start server — ${error.message}`));

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();

  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);

    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // Anything the server prints to stdout that is not JSON-RPC would corrupt
      // the stream for a real client, so treat it as a failure rather than skip.
      finish(1, `FAIL  non-JSON on stdout: ${line.slice(0, 120)}`);
      return;
    }

    if (message.id === 1) {
      const name = message.result?.serverInfo?.name;
      if (name !== "zerofayyz-fintech-qa") {
        finish(1, `FAIL  unexpected server name: ${name}`);
        return;
      }
      console.log(`  PASS  initialize — ${name} (protocol ${message.result?.protocolVersion})`);
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (message.id === 2) {
      const tools = message.result?.tools ?? [];
      const names = tools.map((tool) => tool.name);
      const missing = EXPECTED_TOOLS.filter((tool) => !names.includes(tool));

      if (missing.length > 0) {
        finish(1, `FAIL  tools/list is missing: ${missing.join(", ")}`);
        return;
      }

      const undescribed = tools.filter((tool) => !tool.description);
      if (undescribed.length > 0) {
        // A tool with no description is invisible to a model deciding what to
        // call, which makes it functionally absent.
        finish(1, `FAIL  no description on: ${undescribed.map((t) => t.name).join(", ")}`);
        return;
      }

      console.log(`  PASS  tools/list — ${tools.length} tools, all described`);
      finish(0, `\nMCP handshake OK (${tools.length} tools)`);
    }
  }
});

console.log("\nMCP protocol handshake check\n");

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "handshake-check", version: "1.0.0" },
  },
});
