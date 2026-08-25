import { z } from "zod";
const healthSchema = z.object({
  service: z.string(),
  status: z.enum(["operational", "degraded"]),
  environment: z.string(),
  version: z.string(),
  timestamp: z.string(),
  checks: z.object({
    database: z.object({
      status: z.enum(["operational", "unavailable"]),
      latencyMs: z.number().int().nonnegative().nullable(),
      name: z.string().nullable()
    }),
    stripe: z.object({ status: z.enum(["configured", "unconfigured"]) }),
    webhook: z.object({ status: z.enum(["configured", "unconfigured"]) }),
    // Optional on purpose: the clients deploy separately from the API, so a
    // client built before the API rolls this out must still validate.
    clientOrigins: z.object({
      status: z.enum(["configured", "unconfigured"]),
      count: z.number().int().nonnegative()
    }).optional()
  })
});
const metricsSchema = z.object({
  currency: z.string().length(3),
  grossVolumeMinor: z.number().int().nonnegative(),
  succeededCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100).nullable(),
  pending: z.object({
    amountMinor: z.number().int().nonnegative(),
    count: z.number().int().nonnegative()
  }),
  eventsRecorded: z.number().int().nonnegative(),
  dailyVolume: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amountMinor: z.number().int().nonnegative()
    })
  )
});
const transactionsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      customer: z.object({ displayName: z.string(), email: z.string() }),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      status: z.string(),
      methodLabel: z.string(),
      createdAt: z.string()
    })
  ),
  meta: z.object({
    count: z.number().int().nonnegative(),
    source: z.literal("postgresql")
  })
});
const checkoutSchema = z.object({
  checkoutSessionId: z.string(),
  url: z.string().url()
});
const MIN_AMOUNT_MINOR = 50;
const MAX_AMOUNT_MINOR = 15e5;
function toMinorUnits(input) {
  const trimmed = input.trim().replace(/^[¥￥]/, "").replace(/,/g, "");
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const minor = Number(trimmed);
  if (minor < MIN_AMOUNT_MINOR || minor > MAX_AMOUNT_MINOR) {
    return null;
  }
  return minor;
}
const sessionUserSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  role: z.enum(["viewer", "operator", "admin"])
});
z.object({
  user: sessionUserSchema,
  expiresAt: z.string()
});
z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      action: z.string(),
      entityType: z.string(),
      entityId: z.string().nullable(),
      actorEmail: z.string().nullable(),
      sessionId: z.string().nullable(),
      clientFingerprint: z.string().nullable(),
      metadata: z.record(z.string(), z.unknown()),
      createdAt: z.string()
    })
  )
});
async function getValidated(path, schema, fetcher = globalThis.fetch) {
  const response = await fetcher(path, { signal: AbortSignal.timeout(45e3) });
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`${path} returned an unexpected shape: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}
const fetchHealth = (fetcher) => getValidated("/api/v1/health", healthSchema, fetcher);
const fetchMetrics = (fetcher) => getValidated("/api/v1/metrics", metricsSchema, fetcher);
const fetchTransactions = (fetcher) => getValidated("/api/v1/transactions", transactionsSchema, fetcher);
async function startCheckout(amountMinor) {
  const response = await fetch("/api/v1/payments/checkout-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(amountMinor === void 0 ? {} : { amountMinor }),
    signal: AbortSignal.timeout(45e3)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === "string" ? payload.error : `Checkout failed (${response.status})`
    );
  }
  return checkoutSchema.parse(payload).url;
}
export {
  fetchMetrics as a,
  fetchTransactions as b,
  fetchHealth as f,
  startCheckout as s,
  toMinorUnits as t
};
