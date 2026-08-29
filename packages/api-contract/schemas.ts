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
    // Optional on purpose: the clients deploy separately from the API, so a
    // client built before the API rolls this out must still validate.
    clientOrigins: z
      .object({
        status: z.enum(["configured", "unconfigured"]),
        count: z.number().int().nonnegative(),
      })
      .optional(),
    // Optional for the same reason, and added later for the same lesson: the API
    // had been reporting errorTracking for weeks while every client dropped it,
    // because a Zod object strips what it does not name. A field the API sends
    // and the contract omits is invisible, not extra.
    errorTracking: z
      .object({ status: z.enum(["configured", "unconfigured"]) })
      .optional(),
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
    // Optional for the same reason clientOrigins is on healthSchema: the
    // clients deploy separately from the API, so a client compiled against
    // this must validate an older API that has not learned to page yet.
    total: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
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
 * The floor is Stripe's own JPY minimum charge (¥50). The ceiling is ours,
 * chosen because the checkout endpoint is public: an unbounded amount lets one
 * stranger put nine digits into a shared dashboard's headline figure.
 */
export const MIN_AMOUNT_MINOR = 50;
export const MAX_AMOUNT_MINOR = 1_500_000;

/** Yen as typed → integer minor units, or null when it is not a valid amount.
 *
 * JPY is a zero-decimal currency: one minor unit is one yen, so "4200.50" is
 * not an amount of yen at all and there is no fractional part to parse. The
 * float hazards of a cents currency (17.35 * 100 being 1734.999… in IEEE-754)
 * never arise here, because nothing is ever multiplied.
 */
export function toMinorUnits(input: string): number | null {
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

/**
 * The authenticated half of the contract.
 *
 * Every client that grows a staff door validates these the same way it
 * validates the ledger reads: at the boundary, loudly, with the endpoint
 * named. The role enum is deliberately closed — a new role appearing in a
 * response is a contract change, and a contract change should fail a client
 * rather than silently rendering an unknown badge.
 */

export const sessionUserSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  role: z.enum(["viewer", "operator", "admin"]),
});

export const loginResponseSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.string(),
});

export const auditLogsSchema = z.object({
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
      createdAt: z.string(),
    }),
  ),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type AuditLogs = z.infer<typeof auditLogsSchema>;
