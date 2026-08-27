/**
 * Webhook replay.
 *
 * Stripe delivers at least once, so the same event can and does arrive twice.
 * The API enforces idempotency with a unique constraint on `provider_event_id`
 * and `ON CONFLICT DO NOTHING`, rather than by branching in application code —
 * a database guarantee holds under concurrency, an `if (alreadySeen)` does not.
 *
 * This tool proves that guarantee from the outside: deliver a signed event
 * twice and assert the platform accepted both deliveries while recording the
 * effect once. A test that only ever delivers an event once cannot tell a
 * working idempotency key from a missing one.
 */

import { createHmac } from "node:crypto";

import type { ApiClient } from "../api-client.js";

export type ReplayReport = {
  configured: boolean;
  eventId: string;
  deliveries: Array<{ attempt: number; status: number; latencyMs: number }>;
  eventsBefore: number | null;
  eventsAfter: number | null;
  idempotent: boolean | null;
  summary: string;
};

/**
 * Build the `Stripe-Signature` header for a payload, exactly as Stripe does:
 * HMAC-SHA256 over `timestamp.payload` keyed by the endpoint secret.
 */
export function signPayload(
  payload: string,
  secret: string,
  timestampSeconds: number,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");

  return `t=${timestampSeconds},v1=${signature}`;
}

export function buildReplayEvent(eventId: string, nowSeconds: number): string {
  // A payment_intent.succeeded for an intent the platform has never issued.
  // The handler records the event and finds no local payment to advance, which
  // is exactly the path we want to exercise: the ledger must not move, but the
  // event must be recorded once and only once.
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "payment_intent.succeeded",
    created: nowSeconds,
    livemode: false,
    data: {
      object: {
        id: `pi_replay_${eventId}`,
        object: "payment_intent",
        amount: 0,
        currency: "jpy",
        status: "succeeded",
        metadata: { source: "mcp-replay-probe" },
      },
    },
  });
}

async function readEventCount(client: ApiClient): Promise<number | null> {
  try {
    const result = await client.request("/api/v1/metrics");
    const recorded = (result.body as { eventsRecorded?: unknown } | null)
      ?.eventsRecorded;

    return typeof recorded === "number" ? recorded : null;
  } catch {
    return null;
  }
}

export async function replayWebhook(
  client: ApiClient,
  options: {
    secret: string | null;
    eventId: string;
    nowSeconds: number;
    attempts?: number;
  },
): Promise<ReplayReport> {
  const { secret, eventId, nowSeconds } = options;
  const attempts = options.attempts ?? 2;

  if (!secret) {
    return {
      configured: false,
      eventId,
      deliveries: [],
      eventsBefore: null,
      eventsAfter: null,
      idempotent: null,
      summary:
        "STRIPE_WEBHOOK_SECRET is not configured, so no signed event can be " +
        "delivered. Set it to exercise replay.",
    };
  }

  const payload = buildReplayEvent(eventId, nowSeconds);
  const signature = signPayload(payload, secret, nowSeconds);
  const eventsBefore = await readEventCount(client);
  const deliveries: ReplayReport["deliveries"] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await client.request("/api/v1/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });

    deliveries.push({
      attempt,
      status: result.status,
      latencyMs: result.latencyMs,
    });
  }

  const eventsAfter = await readEventCount(client);
  const allAccepted = deliveries.every((delivery) => delivery.status === 200);

  // The platform must accept every delivery — refusing a duplicate with an
  // error would make Stripe retry forever — while recording it exactly once.
  const recordedOnce =
    eventsBefore === null || eventsAfter === null
      ? null
      : eventsAfter - eventsBefore <= 1;

  const idempotent = recordedOnce === null ? null : allAccepted && recordedOnce;

  let summary: string;

  if (!allAccepted) {
    const statuses = deliveries.map((d) => d.status).join(", ");
    summary = `Not idempotent: the platform did not accept every delivery (statuses: ${statuses}).`;
  } else if (idempotent === null) {
    summary =
      `All ${attempts} deliveries were accepted, but the event count could not ` +
      "be read, so single-recording is unverified.";
  } else if (idempotent) {
    summary =
      `Idempotent: ${attempts} identical deliveries were all accepted and the ` +
      `recorded-event count moved by ${(eventsAfter ?? 0) - (eventsBefore ?? 0)}.`;
  } else {
    summary =
      `NOT idempotent: ${attempts} deliveries moved the recorded-event count by ` +
      `${(eventsAfter ?? 0) - (eventsBefore ?? 0)}, expected at most 1.`;
  }

  return {
    configured: true,
    eventId,
    deliveries,
    eventsBefore,
    eventsAfter,
    idempotent,
    summary,
  };
}
