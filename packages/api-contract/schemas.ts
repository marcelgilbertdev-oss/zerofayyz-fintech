import { z } from "zod";

/**
 * Runtime validation of every API response, at the boundary.
 *
 * The API is typed, but this client compiles against a *copy* of that contract
 * — nothing at build time proves the deployed API still matches it. Zod turns
 * that assumption into a runtime check: a drifted response fails loudly at the
 * edge with a named field, instead of surfacing as `undefined` three
 * components deep.
 */

export const healthSchema = z.object({
  service: z.string(),
  status: z.enum(["operational", "degraded"]),
  environment: z.string(),
  version: z.string(),
  timestamp: z.string(),
  checks: z.object({
    database: z.object({
      status: z.enum(["operational", "unavailable"]),
      latencyMs: z.number().int().nonnegative().nullable(),
      name: z.string().nullable(),
    }),
    stripe: z.object({ status: z.enum(["configured", "unconfigured"]) }),
    webhook: z.object({ status: z.enum(["configured", "unconfigured"]) }),
  }),
});

export const metricsSchema = z.object({
  currency: z.string().length(3),
  grossVolumeMinor: z.number().int().nonnegative(),
  succeededCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100).nullable(),
  pending: z.object({
    amountMinor: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  }),
  eventsRecorded: z.number().int().nonnegative(),
  dailyVolume: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amountMinor: z.number().int().nonnegative(),
    }),
  ),
});

export const transactionsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      customer: z.object({ displayName: z.string(), email: z.string() }),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      status: z.string(),
      methodLabel: z.string(),
      createdAt: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number().int().nonnegative(),
    source: z.literal("postgresql"),
  }),
});

export const checkoutSchema = z.object({
  checkoutSessionId: z.string(),
  url: z.string().url(),
});

export type Health = z.infer<typeof healthSchema>;
export type Metrics = z.infer<typeof metricsSchema>;
export type Transactions = z.infer<typeof transactionsSchema>;

/**
 * Money parsing, shared by every client.
 *
 * These bounds mirror the API's route schema. The server stays the authority —
 * a field in a browser can be edited away, a route schema cannot — but three
 * clients agreeing on one rule beats three clients each inventing their own,
 * which is how a Vue page and a React page start disagreeing about what
 * "$1,000" means.
 *
 * The floor is Stripe's own USD minimum charge. The ceiling is ours, chosen
 * because the checkout endpoint is public: an unbounded amount lets one
 * stranger put nine digits into a shared dashboard's headline figure.
 */
export const MIN_AMOUNT_MINOR = 50;
export const MAX_AMOUNT_MINOR = 1_000_000;

/** Dollars as typed → integer minor units, or null when it is not a valid amount. */
export function toMinorUnits(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "").replace(/,/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  // Parsed as text rather than by multiplying a float by 100: `17.35 * 100` is
  // 1734.9999999999998 in IEEE-754, and a payment ledger is the last place to
  // round someone's money by accident.
  const [dollars, cents = ""] = trimmed.split(".");
  const minor = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));

  if (minor < MIN_AMOUNT_MINOR || minor > MAX_AMOUNT_MINOR) {
    return null;
  }

  return minor;
}
