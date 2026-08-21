import type { z } from "zod";

import {
  checkoutSchema,
  healthSchema,
  metricsSchema,
  transactionsSchema,
} from "./schemas";

/**
 * Same-origin paths only; the dev server proxies /api locally and the platform
 * rewrites it in production, so the API's real origin never reaches the
 * browser. See vite.config.ts.
 */
async function getValidated<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  // 45s, not 15: the API runs on a free tier that sleeps, the scheduled
  // keep-warm drifts (observed running every 33-43 minutes against a 10-minute
  // cron), and a cold start takes ~22s. A timeout shorter than the wake-up
  // turns every cold start into a dead error page.
  const response = await fetch(path, { signal: AbortSignal.timeout(45_000) });

  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }

  // safeParse rather than parse: the throw site should name the endpoint, not
  // just the field, because "which API drifted" is the actual question at 2am.
  const parsed = schema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error(`${path} returned an unexpected shape: ${parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`);
  }

  return parsed.data;
}

export const fetchHealth = () => getValidated("/api/v1/health", healthSchema);
export const fetchMetrics = () => getValidated("/api/v1/metrics", metricsSchema);
export const fetchTransactions = () =>
  getValidated("/api/v1/transactions", transactionsSchema);

export async function startCheckout(): Promise<string> {
  const response = await fetch("/api/v1/payments/checkout-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Checkout failed (${response.status})`;
    throw new Error(message);
  }

  return checkoutSchema.parse(payload).url;
}
