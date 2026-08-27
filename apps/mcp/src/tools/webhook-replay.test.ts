import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { ApiClient } from "../api-client.js";
import { loadConfig } from "../config.js";
import {
  buildReplayEvent,
  replayWebhook,
  signPayload,
} from "./webhook-replay.js";

const config = loadConfig({ MCP_API_URL: "https://api.test" });

describe("signPayload", () => {
  it("signs timestamp.payload the way Stripe does", () => {
    const signature = signPayload("{}", "whsec_test", 1_700_000_000);
    const expected = createHmac("sha256", "whsec_test")
      .update("1700000000.{}")
      .digest("hex");

    assert.equal(signature, `t=1700000000,v1=${expected}`);
  });

  it("produces a different signature when the payload changes", () => {
    const a = signPayload('{"a":1}', "whsec_test", 1_700_000_000);
    const b = signPayload('{"a":2}', "whsec_test", 1_700_000_000);

    assert.notEqual(a, b);
  });

  it("produces a different signature when the timestamp changes", () => {
    // Stripe's scheme signs the timestamp precisely so a captured payload
    // cannot be replayed later with its original signature.
    const a = signPayload("{}", "whsec_test", 1_700_000_000);
    const b = signPayload("{}", "whsec_test", 1_700_000_001);

    assert.notEqual(a, b);
  });
});

describe("buildReplayEvent", () => {
  it("builds a parseable event carrying a probe marker", () => {
    const event = JSON.parse(buildReplayEvent("evt_1", 1_700_000_000));

    assert.equal(event.id, "evt_1");
    assert.equal(event.type, "payment_intent.succeeded");
    assert.equal(event.livemode, false);
    assert.equal(event.data.object.metadata.source, "mcp-replay-probe");
  });
});

describe("replayWebhook", () => {
  it("reports unconfigured rather than failing when no secret is set", async () => {
    const client = new ApiClient(config, async () => {
      throw new Error("should not be called");
    });

    const report = await replayWebhook(client, {
      secret: null,
      eventId: "evt_1",
      nowSeconds: 1_700_000_000,
    });

    assert.equal(report.configured, false);
    assert.equal(report.idempotent, null);
    assert.equal(report.deliveries.length, 0);
    assert.match(report.summary, /not configured/);
  });

  it("passes when both deliveries are accepted and the count moves by one", async () => {
    let eventsRecorded = 10;
    let deliveries = 0;

    const client = new ApiClient(config, async (url) => {
      if (url.endsWith("/api/v1/metrics")) {
        return Response.json({ eventsRecorded });
      }

      deliveries += 1;
      // Only the first delivery records; the duplicate is swallowed by the
      // unique constraint, which is exactly the behaviour under test.
      if (deliveries === 1) {
        eventsRecorded += 1;
      }

      return Response.json({ received: true });
    });

    const report = await replayWebhook(client, {
      secret: "whsec_test",
      eventId: "evt_1",
      nowSeconds: 1_700_000_000,
    });

    assert.equal(report.configured, true);
    assert.equal(report.deliveries.length, 2);
    assert.equal(report.idempotent, true);
    assert.equal(report.eventsBefore, 10);
    assert.equal(report.eventsAfter, 11);
  });

  it("fails when a duplicate delivery is recorded twice", async () => {
    let eventsRecorded = 10;

    const client = new ApiClient(config, async (url) => {
      if (url.endsWith("/api/v1/metrics")) {
        return Response.json({ eventsRecorded });
      }

      // A platform with no idempotency guarantee: every delivery counts.
      eventsRecorded += 1;
      return Response.json({ received: true });
    });

    const report = await replayWebhook(client, {
      secret: "whsec_test",
      eventId: "evt_1",
      nowSeconds: 1_700_000_000,
    });

    assert.equal(report.idempotent, false);
    assert.match(report.summary, /NOT idempotent/);
  });

  it("fails when the platform refuses a duplicate instead of accepting it", async () => {
    let deliveries = 0;

    const client = new ApiClient(config, async (url) => {
      if (url.endsWith("/api/v1/metrics")) {
        return Response.json({ eventsRecorded: 10 });
      }

      deliveries += 1;
      // Refusing a retry with an error makes Stripe redeliver forever — a
      // failure mode that looks like correctness if you only count rows.
      return deliveries === 1
        ? Response.json({ received: true })
        : new Response("duplicate", { status: 409 });
    });

    const report = await replayWebhook(client, {
      secret: "whsec_test",
      eventId: "evt_1",
      nowSeconds: 1_700_000_000,
    });

    assert.equal(report.idempotent, false);
    assert.match(report.summary, /did not accept every delivery/);
  });

  it("reports unverified rather than passing when metrics cannot be read", async () => {
    const client = new ApiClient(config, async (url) => {
      if (url.endsWith("/api/v1/metrics")) {
        return new Response("nope", { status: 500 });
      }

      return Response.json({ received: true });
    });

    const report = await replayWebhook(client, {
      secret: "whsec_test",
      eventId: "evt_1",
      nowSeconds: 1_700_000_000,
    });

    assert.equal(report.idempotent, null);
    assert.match(report.summary, /unverified/);
  });
});
