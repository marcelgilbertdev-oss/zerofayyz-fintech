import type { z } from "zod";

import {
  auditLogsSchema,
  checkoutSchema,
  healthSchema,
  loginResponseSchema,
  metricsSchema,
  sessionUserSchema,
  transactionsSchema,
} from "./schemas";
import type { AuditLogs, SessionUser } from "./schemas";

/**
 * Same-origin paths only; see vite.config.ts for the proxy and rewrite posture.
 *
 * `fetcher` is injectable because SvelteKit's `load` receives its own
 * instrumented `fetch`, and reaching for the global inside a load function
 * bypasses the framework. Everywhere else the global is the default, so
 * nothing outside `load` had to change.
 */
export type Fetcher = typeof globalThis.fetch;

async function getValidated<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
  fetcher: Fetcher = globalThis.fetch,
): Promise<z.infer<Schema>> {
  // 45s, not 15: the API runs on a free tier that sleeps, the scheduled
  // keep-warm drifts (observed running every 33-43 minutes against a 10-minute
  // cron), and a cold start takes ~22s. A timeout shorter than the wake-up
  // turns every cold start into a dead error page.
  const response = await fetcher(path, { signal: AbortSignal.timeout(45_000) });

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

export const fetchHealth = (fetcher?: Fetcher) =>
  getValidated("/api/v1/health", healthSchema, fetcher);
export const fetchMetrics = (fetcher?: Fetcher) =>
  getValidated("/api/v1/metrics", metricsSchema, fetcher);
export const fetchTransactions = (fetcher?: Fetcher) =>
  getValidated("/api/v1/transactions", transactionsSchema, fetcher);

export async function startCheckout(amountMinor?: number): Promise<string> {
  const response = await fetch("/api/v1/payments/checkout-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(amountMinor === undefined ? {} : { amountMinor }),
    signal: AbortSignal.timeout(45_000),
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

/**
 * The staff door. Cookies ride along automatically because every request is
 * same-origin — the session cookie the API sets through the login response
 * never needs JavaScript to carry it, and HttpOnly means it couldn't anyway.
 */

/** A 401 from a resource that needs a session — distinct from "API broke". */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session ended — sign in again.");
    this.name = "SessionExpiredError";
  }
}

/** Who the cookie says we are, or null when it says nothing. */
export async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch("/api/v1/auth/me", {
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`/api/v1/auth/me responded ${response.status}`);
  }

  return sessionUserSchema.parse(await response.json());
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;

  if (!response.ok) {
    // The API's own refusal, verbatim: "Incorrect email or password" and the
    // rate limiter's "Too many attempts" are part of the contract, and
    // paraphrasing them here would hide what the server actually enforces.
    throw new Error(
      payload && typeof payload.error === "string"
        ? payload.error
        : "Unable to sign in",
    );
  }

  return loginResponseSchema.parse(payload).user;
}

export async function signOut(): Promise<void> {
  const response = await fetch("/api/v1/auth/logout", {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`/api/v1/auth/logout responded ${response.status}`);
  }
}

/** Operator-gated: the append-only audit trail, newest first. */
export async function fetchAuditTrail(limit = 8): Promise<AuditLogs> {
  const response = await fetch(`/api/v1/admin/audit-logs?limit=${limit}`, {
    signal: AbortSignal.timeout(45_000),
  });

  if (response.status === 401) {
    throw new SessionExpiredError();
  }

  if (!response.ok) {
    throw new Error(`/api/v1/admin/audit-logs responded ${response.status}`);
  }

  const parsed = auditLogsSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error(
      `/api/v1/admin/audit-logs returned an unexpected shape: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}
