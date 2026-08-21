import type { z } from "zod";

import {
  checkoutSchema,
  healthSchema,
  metricsSchema,
  transactionsSchema,
} from "./schemas";

/** Same-origin paths only; see vite.config.ts for the proxy and rewrite posture. */
async function getValidated<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const response = await fetch(path, { signal: AbortSignal.timeout(15_000) });

  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }

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
    signal: AbortSignal.timeout(15_000),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === "string"
        ? payload.error
        : `Checkout failed (${response.status})`,
    );
  }

  return checkoutSchema.parse(payload).url;
}
