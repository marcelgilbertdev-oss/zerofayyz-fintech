/**
 * Scenario lifecycle. Two jobs: fail fast with a *useful* message when the
 * stack is not ready, and leave the database the way each scenario found it.
 */

import { After, AfterAll, Before, BeforeAll } from "@cucumber/cucumber";

import { API_URL, WEB_URL, PlatformWorld } from "./world.js";

BeforeAll(async function () {
  let health: { checks?: { webhook?: { status?: string } } };

  try {
    const response = await fetch(`${API_URL}/api/v1/health`);
    health = (await response.json()) as typeof health;
  } catch {
    throw new Error(
      `No API at ${API_URL}. Start the stack first — \`npm run test:bdd\` does ` +
        "this for you; if you are running cucumber directly, that is the miss.",
    );
  }

  try {
    await fetch(WEB_URL);
  } catch {
    throw new Error(`API is up but no dashboard at ${WEB_URL}.`);
  }

  // The webhook feature needs the API started with a signing secret. A stack
  // left over from the plain e2e suite will not have one — say so precisely,
  // instead of letting two scenarios fail with a bare 503.
  if (health.checks?.webhook?.status !== "configured") {
    throw new Error(
      `The API at ${API_URL} has no STRIPE_WEBHOOK_SECRET, so the webhook ` +
        "idempotency feature cannot run. Restart the stack via `npm run " +
        "test:bdd`, which supplies one — or stop the stale server on :4000.",
    );
  }
});

/**
 * Refund scenarios raise real pending requests, and the schema allows only
 * one pending request per payment — so a scenario that dies mid-flight would
 * poison every later run. Clear the queue before AND after: before, because a
 * previous crashed run may have left debris; after, out of courtesy to
 * whatever runs next (including the Playwright e2e suite on the same database).
 */
async function clearPendingRefunds(world: PlatformWorld): Promise<void> {
  await world.signIn("admin");
  const list = await world.api("/api/v1/admin/refund-requests", {}, "admin");
  const requests = (world.json<{ data: Array<{ id: string; status: string; requestedBy: string | null }> }>(list).data ?? [])
    .filter((request) => request.status === "pending");

  for (const request of requests) {
    // The admin cannot reject their own request — withdraw those instead.
    const admin = await world.api("/api/v1/auth/me", {}, "admin");
    const adminEmail = world.json<{ email: string }>(admin).email;
    const action = request.requestedBy === adminEmail ? "withdraw" : "reject";
    const body =
      action === "reject" ? JSON.stringify({ note: "Cleared by the BDD suite" }) : undefined;

    await world.api(`/api/v1/admin/refund-requests/${request.id}/${action}`, {
      method: "POST",
      ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
    }, "admin");
  }

  // The cleanup's own requests should not leak into the scenario's assertions.
  world.captured = [];
  world.cookies.clear();
}

Before({ tags: "@refunds" }, async function (this: PlatformWorld) {
  await clearPendingRefunds(this);
});

After({ tags: "@refunds" }, async function (this: PlatformWorld) {
  await clearPendingRefunds(this);
});

/**
 * Safety net for the disabled-account scenario: its own last step re-enables
 * the operator, but a failed assertion earlier in the scenario would skip it —
 * and a disabled demo operator poisons every later scenario, the Playwright
 * suite, and anyone using the local stack. Re-enabling is idempotent.
 */
After({ tags: "@reenable-operator" }, async function (this: PlatformWorld) {
  await this.signIn("admin");
  const users = await this.api("/api/v1/admin/users", {}, "admin");
  const operator = this.json<{ data: Array<{ id: string; email: string }> }>(users)
    .data.find((row) => row.email === "demo@zerofayyz.test");

  if (operator) {
    await this.api(`/api/v1/admin/users/${operator.id}/enable`, { method: "POST" }, "admin");
  }
});

After(async function (this: PlatformWorld) {
  await this.closeBrowser();
});

AfterAll(async function () {
  // Every browser is scenario-scoped and closed in After; nothing global.
});
