#!/usr/bin/env node
/**
 * BDD suite orchestrator: seed, boot, run, tear down.
 *
 *   npm run test:bdd
 *
 * Owns the whole lifecycle because the Gherkin features cross the stack — the
 * API, the dashboard and the database together — and half the value of a BDD
 * suite evaporates the moment running it needs a page of setup instructions.
 *
 * The API is started with a THROWAWAY Stripe key and webhook secret. Webhook
 * signature verification is offline HMAC, so a dummy key exercises the real
 * verification path without any Stripe account; nothing here can reach Stripe
 * and nothing here can move real money.
 *
 * If a stack is already listening it is reused — but only after checking it
 * was started with a webhook secret. A leftover server from the Playwright
 * e2e suite has none, and reusing it would fail two scenarios with a bare 503
 * instead of one clear sentence.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const API_ROOT = path.resolve(WEB_ROOT, "../api");

const API_URL = process.env.BDD_API_URL ?? "http://127.0.0.1:4000";
const WEB_URL = process.env.BDD_WEB_URL ?? "http://127.0.0.1:3000";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_bdd_local_test_secret";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "ci-throwaway-admin-password";

const children = [];

function shutdown() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json().catch(() => ({})) : null;
  } catch {
    return null;
  }
}

async function waitFor(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await probe(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`${label} did not become healthy within ${timeoutMs}ms`);
}

function start(label, command, args, cwd, env) {
  console.log(`  starting ${label}…`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
  });
  children.push(child);
  return child;
}

// ------------------------------------------------------------ 1. seed

console.log("\nBDD suite — seed, boot, run\n");
console.log("  seeding demo data and staff accounts…");

for (const script of ["seed:demo", "seed:staff"]) {
  execFileSync("npm", ["run", script], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL, ADMIN_PASSWORD },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// ------------------------------------------------------------ 2. boot

const existingApi = await probe(`${API_URL}/api/v1/health`);

if (existingApi) {
  if (existingApi.checks?.webhook?.status !== "configured") {
    console.error(
      `\nA server is already listening at ${API_URL}, but it has no webhook ` +
        "secret — probably left over from the Playwright e2e suite. Stop it " +
        "and re-run, so this script can start one with the BDD environment.",
    );
    process.exit(1);
  }
  console.log("  reusing the API already listening on :4000");
} else {
  // Always rebuild: a stale dist/ is indistinguishable from a real regression
  // from out here, and this suite already lost a run to exactly that.
  console.log("  building the API…");
  execFileSync("npm", ["run", "build"], { cwd: API_ROOT, stdio: ["ignore", "ignore", "inherit"] });
  start("API", "npm", ["start"], API_ROOT, {
    DATABASE_URL,
    // Dummy on purpose: signature verification is offline, and a key that
    // cannot authenticate anywhere is the guarantee no test can move money.
    // The gateway reads STRIPE_API_KEY (not _SECRET_KEY — checked, not assumed).
    STRIPE_API_KEY: process.env.STRIPE_API_KEY ?? "sk_test_bdd_dummy_key",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  await waitFor(`${API_URL}/api/v1/health`, "the API");
}

const existingWeb = await probe(WEB_URL);

if (existingWeb) {
  console.log("  reusing the dashboard already listening on :3000");
} else {
  if (!existsSync(path.join(WEB_ROOT, ".next"))) {
    console.log("  building the dashboard (first run)…");
    execFileSync("npm", ["run", "build"], { cwd: WEB_ROOT, stdio: "inherit" });
  }
  start("dashboard", "npm", ["run", "start"], WEB_ROOT, {});
  await waitFor(WEB_URL, "the dashboard");
}

// ------------------------------------------------------------ 3. run

console.log("");

/**
 * Cucumber supports LTS Node lines only (22, 24, 26+); odd-numbered releases
 * are refused at startup. The servers above run happily on whatever Node is
 * current — only the cucumber child needs an LTS. Prefer an explicit
 * BDD_NODE_BIN, then the Homebrew node@22 keg, then give up with the fix.
 */
const nodeMajor = Number(process.versions.node.split(".")[0]);
const unsupported = nodeMajor % 2 === 1;
const ltsBin = process.env.BDD_NODE_BIN ?? "/opt/homebrew/opt/node@22/bin";
let pathPrefix = "";

if (unsupported) {
  if (existsSync(path.join(ltsBin, "node"))) {
    pathPrefix = `${ltsBin}:`;
    console.log(`  (cucumber runs on Node 22 from ${ltsBin} — Node ${nodeMajor} is not an LTS line)`);
  } else {
    console.error(
      `
Cucumber does not support Node ${nodeMajor}. Install an LTS next to it ` +
        "(`brew install node@22`) or point BDD_NODE_BIN at one.",
    );
    shutdown();
    process.exit(1);
  }
}

const cucumber = spawn("npx", ["cucumber-js"], {
  cwd: WEB_ROOT,
  env: {
    ...process.env,
    PATH: `${pathPrefix}${process.env.PATH ?? ""}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import tsx`.trim(),
    BDD_API_URL: API_URL,
    BDD_WEB_URL: WEB_URL,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    E2E_ADMIN_PASSWORD: ADMIN_PASSWORD,
  },
  stdio: "inherit",
  shell: false,
});

cucumber.on("close", (code) => {
  shutdown();
  process.exit(code ?? 1);
});
