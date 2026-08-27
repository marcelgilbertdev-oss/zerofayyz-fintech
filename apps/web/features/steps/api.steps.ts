/**
 * Step definitions for the API-level features. Each step is deliberately
 * thin: find the thing, do the thing, capture the response. Assertions live
 * in Then-steps; state travels on the World, never in module scope.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { Given, Then, When } from "@cucumber/cucumber";

import {
  ADMIN,
  BDD_WEBHOOK_SECRET,
  OPERATOR,
  type Actor,
  type PlatformWorld,
} from "../support/world.js";

// ---------------------------------------------------------------- sign-in

Given("the admin is signed in", async function (this: PlatformWorld) {
  await this.signIn("admin");
});

Given("the operator is signed in", async function (this: PlatformWorld) {
  await this.signIn("operator");
});

Given("no refund request is pending", async function (this: PlatformWorld) {
  const list = await this.api("/api/v1/admin/refund-requests", {}, "admin");
  const pending = this.json<{ data: Array<{ status: string }> }>(list)
    .data.filter((row) => row.status === "pending");
  assert.equal(pending.length, 0, "the @refunds Before hook should have cleared these");
});

// ---------------------------------------------------------------- refunds

async function findSucceededPaymentRow(
  world: PlatformWorld,
): Promise<{ id: string; amountMinor: number }> {
  // The payments ledger is public by design (demo platform); no session needed,
  // which also lets webhook scenarios use it without a sign-in Given.
  const response = await world.api("/api/v1/payments?status=succeeded");
  const rows = world.json<{ data: Array<{ id: string; amountMinor: number }> }>(response).data;
  const row = rows[0];
  assert.ok(row, "the seed data should contain at least one succeeded payment");
  world.captured.pop(); // a lookup, not part of the scenario's assertions
  return row;
}

async function raiseRefund(
  world: PlatformWorld,
  actor: Actor,
  reason: string,
  amountMinor?: number,
): Promise<void> {
  const { id: paymentId } = await findSucceededPaymentRow(world);
  const response = await world.api(
    `/api/v1/admin/payments/${paymentId}/refund-requests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, ...(amountMinor ? { amountMinor } : {}) }),
    },
    actor,
  );

  if (response.status === 201) {
    world.refundRequestId = world.json<{ id: string }>(response).id;
  }
}

When(
  "the admin requests a refund on a succeeded payment because {string}",
  async function (this: PlatformWorld, reason: string) {
    await raiseRefund(this, "admin", reason);
  },
);

When(
  "the operator requests a refund on a succeeded payment because {string}",
  async function (this: PlatformWorld, reason: string) {
    await raiseRefund(this, "operator", reason);
  },
);

When(
  "the admin requests a refund of {int} minor units on a succeeded payment because {string}",
  async function (this: PlatformWorld, amountMinor: number, reason: string) {
    await raiseRefund(this, "admin", reason, amountMinor);
  },
);

When(
  /^the (admin|operator) tries to approve that refund request$/,
  async function (this: PlatformWorld, actor: Actor) {
    assert.ok(this.refundRequestId, "no refund request was raised in this scenario");
    await this.api(
      `/api/v1/admin/refund-requests/${this.refundRequestId}/approve`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      actor,
    );
  },
);

When(
  "the admin rejects that refund request with the note {string}",
  async function (this: PlatformWorld, note: string) {
    assert.ok(this.refundRequestId, "no refund request was raised in this scenario");
    await this.api(
      `/api/v1/admin/refund-requests/${this.refundRequestId}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      },
      "admin",
    );
  },
);

Then(
  /^the (?:approval|request) is refused with status (\d+)$/,
  function (this: PlatformWorld, status: string) {
    const last = this.captured.at(-1);
    assert.ok(last, "no response captured");
    assert.equal(last.status, Number(status), `body was: ${last.body}`);
  },
);

Then("the refusal explains {string}", function (this: PlatformWorld, message: string) {
  const last = this.captured.at(-1);
  assert.ok(last, "no response captured");
  assert.equal(this.json<{ error: string }>(last).error, message);
});

async function refundStatus(world: PlatformWorld): Promise<string> {
  const list = await world.api("/api/v1/admin/refund-requests", {}, "admin");
  const row = world
    .json<{ data: Array<{ id: string; status: string }> }>(list)
    .data.find((entry) => entry.id === world.refundRequestId);
  assert.ok(row, "the scenario's refund request is missing from the queue");
  return row.status;
}

Then("that refund request is still pending", async function (this: PlatformWorld) {
  assert.equal(await refundStatus(this), "pending");
});

Then("the refund request is rejected", async function (this: PlatformWorld) {
  assert.equal(await refundStatus(this), "rejected");
});

// ------------------------------------------------------------ sign-in discretion

async function attemptSignIn(
  world: PlatformWorld,
  email: string,
  password: string,
): Promise<void> {
  await world.api("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

When(
  "someone signs in as the operator with the wrong password",
  async function (this: PlatformWorld) {
    await attemptSignIn(this, OPERATOR.email, "definitely-not-the-password");
  },
);

When(
  "someone signs in as the operator with the correct password",
  async function (this: PlatformWorld) {
    await attemptSignIn(this, OPERATOR.email, OPERATOR.password);
  },
);

When(
  "someone signs in as {string} with any password",
  async function (this: PlatformWorld, email: string) {
    await attemptSignIn(this, email, "any-password-at-all");
  },
);

Then(/^both attempts fail with status (\d+)$/, function (this: PlatformWorld, status: string) {
  const [a, b] = this.captured.slice(-2);
  assert.ok(a && b, "expected two captured sign-in attempts");
  assert.equal(a.status, Number(status));
  assert.equal(b.status, Number(status));
});

Then("the two response bodies are byte-identical", function (this: PlatformWorld) {
  const [a, b] = this.captured.slice(-2);
  assert.ok(a && b, "expected two captured responses");
  assert.equal(a.body, b.body);
});

Then("the sign-in succeeds", function (this: PlatformWorld) {
  const last = this.captured.at(-1);
  assert.ok(last);
  assert.equal(last.status, 200, `body was: ${last.body}`);
});

Then("the session cookie is marked HttpOnly", function (this: PlatformWorld) {
  const last = this.captured.at(-1);
  assert.ok(last);
  const cookies = last.headers.getSetCookie?.() ?? [];
  const cookie = cookies[0] ?? last.headers.get("set-cookie");
  assert.ok(cookie, "no Set-Cookie header on the successful sign-in");
  assert.match(cookie, /httponly/i);
});

async function findUserId(world: PlatformWorld, email: string): Promise<string> {
  const response = await world.api("/api/v1/admin/users", {}, "admin");
  const user = world
    .json<{ data: Array<{ id: string; email: string }> }>(response)
    .data.find((row) => row.email === email);
  assert.ok(user, `no user ${email} in the admin user list`);
  return user.id;
}

Given("the admin disables the operator's account", async function (this: PlatformWorld) {
  const id = await findUserId(this, OPERATOR.email);
  const response = await this.api(`/api/v1/admin/users/${id}/disable`, { method: "POST" }, "admin");
  assert.equal(response.status, 200, `disable failed: ${response.body}`);
});

Then("the admin re-enables the operator's account", async function (this: PlatformWorld) {
  const id = await findUserId(this, OPERATOR.email);
  const response = await this.api(`/api/v1/admin/users/${id}/enable`, { method: "POST" }, "admin");
  assert.equal(response.status, 200, `enable failed: ${response.body}`);
});

// ------------------------------------------------------------ yen, pagination

When("the transactions ledger is read from the API", async function (this: PlatformWorld) {
  const response = await this.api("/api/v1/transactions");
  this.stash.set("transactions", this.json(response));
});

Then("every amount is a whole number of minor units", function (this: PlatformWorld) {
  const body = this.stash.get("transactions") as { data: Array<{ amountMinor: number }> };
  assert.ok(body.data.length > 0, "seed data should contain transactions");
  for (const row of body.data) {
    assert.ok(
      Number.isInteger(row.amountMinor),
      `amountMinor ${row.amountMinor} is not an integer`,
    );
  }
});

Then("every currency is {string}", function (this: PlatformWorld, currency: string) {
  const body = this.stash.get("transactions") as { data: Array<{ currency: string }> };
  for (const row of body.data) {
    assert.equal(row.currency, currency);
  }
});

When(
  "the transactions ledger is read with a limit of {int}",
  async function (this: PlatformWorld, limit: number) {
    const response = await this.api(`/api/v1/transactions?limit=${limit}`);
    this.stash.set("page", this.json(response));
  },
);

Then(
  "exactly {int} transactions are returned",
  function (this: PlatformWorld, count: number) {
    const body = this.stash.get("page") as { data: unknown[] };
    assert.equal(body.data.length, count);
  },
);

Then(
  "the response meta echoes a limit of {int}",
  function (this: PlatformWorld, limit: number) {
    const body = this.stash.get("page") as { meta: { limit: number } };
    assert.equal(body.meta.limit, limit);
  },
);

When(
  "the transactions ledger is read with a limit of {int} and an offset of {int}",
  async function (this: PlatformWorld, limit: number, offset: number) {
    const response = await this.api(`/api/v1/transactions?limit=${limit}&offset=${offset}`);
    const key = this.stash.has("page-one") ? "page-two" : "page-one";
    this.stash.set(key, this.json(response));
  },
);

Then("the two pages share no transaction ids", function (this: PlatformWorld) {
  const one = this.stash.get("page-one") as { data: Array<{ id: string }> };
  const two = this.stash.get("page-two") as { data: Array<{ id: string }> };
  assert.ok(one.data.length > 0 && two.data.length > 0, "both pages should have rows");
  const first = new Set(one.data.map((row) => row.id));
  for (const row of two.data) {
    assert.ok(!first.has(row.id), `transaction ${row.id} appears on both pages`);
  }
});

// ------------------------------------------------------------ webhooks

/**
 * A signed checkout.session.completed for a REAL seeded payment. The handler
 * deliberately records nothing for events it cannot tie to a local payment —
 * verified by reading it, after a first draft fabricated an intent and then
 * wondered why the recorded-event count never moved. The event id is unique
 * per call, so each scenario exercises a fresh idempotency key; the session
 * carries the payment's own amount and currency so the ledger row it writes
 * is truthful.
 */
function signedDelivery(
  payment: { id: string; amountMinor: number },
  payloadOverride?: string,
): { payload: string; signature: string } {
  const now = Math.floor(Date.now() / 1000);
  const unique = `${now}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify({
    id: `evt_bdd_${unique}`,
    object: "event",
    type: "checkout.session.completed",
    created: now,
    livemode: false,
    data: {
      object: {
        id: `cs_bdd_${unique}`,
        object: "checkout.session",
        client_reference_id: payment.id,
        payment_status: "paid",
        amount_total: payment.amountMinor,
        currency: "jpy",
        metadata: { source: "bdd-suite" },
      },
    },
  });

  const signedBody = payloadOverride ?? payload;
  const signature = createHmac("sha256", BDD_WEBHOOK_SECRET)
    .update(`${now}.${signedBody}`)
    .digest("hex");

  return { payload, signature: `t=${now},v1=${signature}` };
}

async function deliver(
  world: PlatformWorld,
  payload: string,
  signature: string,
): Promise<void> {
  await world.api("/api/v1/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
}

async function recordedEvents(world: PlatformWorld): Promise<number> {
  const response = await world.api("/api/v1/metrics");
  const count = world.json<{ eventsRecorded: number }>(response).eventsRecorded;
  assert.ok(typeof count === "number", "metrics did not report eventsRecorded");
  world.captured.pop(); // bookkeeping reads should not disturb Then-steps
  return count;
}

Given("the recorded event count is known", async function (this: PlatformWorld) {
  this.stash.set("events-before", await recordedEvents(this));
});

When("Stripe delivers a signed payment event", async function (this: PlatformWorld) {
  const payment = await findSucceededPaymentRow(this);
  const { payload, signature } = signedDelivery(payment);
  this.stash.set("delivery", { payload, signature });
  await deliver(this, payload, signature);
});

When("Stripe delivers the identical event again", async function (this: PlatformWorld) {
  const { payload, signature } = this.stash.get("delivery") as {
    payload: string;
    signature: string;
  };
  await deliver(this, payload, signature);
});

When(
  "Stripe delivers a payment event whose signature does not match its payload",
  async function (this: PlatformWorld) {
    // Sign one payload, deliver another: a valid signature for the wrong bytes.
    const payment = await findSucceededPaymentRow(this);
    const { signature } = signedDelivery(payment, '{"tampered":true}');
    const { payload } = signedDelivery(payment);
    await deliver(this, payload, signature);
  },
);

Then(
  /^both deliveries are accepted with status (\d+)$/,
  function (this: PlatformWorld, status: string) {
    const [a, b] = this.captured.slice(-2);
    assert.ok(a && b, "expected two captured deliveries");
    assert.equal(a.status, Number(status), `first delivery body: ${a.body}`);
    assert.equal(b.status, Number(status), `second delivery body: ${b.body}`);
  },
);

Then("exactly one new event is recorded", async function (this: PlatformWorld) {
  const before = this.stash.get("events-before") as number;
  const after = await recordedEvents(this);
  assert.equal(after - before, 1, `event count moved ${before} → ${after}`);
});

Then(
  /^the delivery is rejected with status (\d+)$/,
  function (this: PlatformWorld, status: string) {
    const last = this.captured.at(-1);
    assert.ok(last);
    assert.equal(last.status, Number(status), `body was: ${last.body}`);
  },
);

// Referenced so the admin credential constant stays imported alongside the
// operator's; sign-ins go through World.signIn, which reads both.
void ADMIN;
