/**
 * Ledger reads.
 *
 * Lets an agent assert on platform state after a test — "the refund I just
 * requested is pending", "no payment moved when that replayed event landed" —
 * instead of inferring it from HTTP status codes.
 *
 * Read-only by construction. The resources below are a fixed map, so there is
 * no path an agent can supply; and the credentials this server signs in with
 * are the demo operator's, which the platform grants read-everything /
 * change-nothing. Two independent reasons the tool cannot mutate the ledger.
 */

import type { ApiClient } from "../api-client.js";

export type LedgerResource =
  | "payments"
  | "transactions"
  | "customers"
  | "events"
  | "audit-logs";

type ResourceDefinition = {
  path: string;
  authenticated: boolean;
  description: string;
};

export const LEDGER_RESOURCES: Record<LedgerResource, ResourceDefinition> = {
  payments: {
    path: "/api/v1/payments",
    authenticated: false,
    description: "Payments and their status lifecycle.",
  },
  transactions: {
    path: "/api/v1/transactions",
    authenticated: false,
    description: "The append-only transaction ledger.",
  },
  customers: {
    path: "/api/v1/customers",
    authenticated: false,
    description: "Customers and their succeeded volume.",
  },
  events: {
    path: "/api/v1/events",
    authenticated: false,
    description: "Recorded provider events.",
  },
  "audit-logs": {
    path: "/api/v1/admin/audit-logs",
    authenticated: true,
    description: "Audit trail. Requires operator credentials.",
  },
};

export type LedgerQuery = {
  resource: LedgerResource;
  limit?: number;
  offset?: number;
  status?: string;
};

export type LedgerResult = {
  resource: LedgerResource;
  path: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  rowCount: number | null;
  /**
   * Who honoured limit/offset. "server" when the API's meta echoes them back,
   * "client" when this tool had to slice the rows itself (the /transactions
   * endpoint ignores its query string — found by the first founder test),
   * null when no paging was requested.
   */
  paging: "server" | "client" | null;
  body: unknown;
};

export function isLedgerResource(value: string): value is LedgerResource {
  return Object.hasOwn(LEDGER_RESOURCES, value);
}

function countRows(body: unknown): number | null {
  if (Array.isArray(body)) {
    return body.length;
  }

  if (body && typeof body === "object") {
    for (const value of Object.values(body)) {
      if (Array.isArray(value)) {
        return value.length;
      }
    }
  }

  return null;
}

/**
 * Did the API actually page this response? The paginated endpoints echo the
 * effective limit/offset back in their meta; an endpoint that ignored the
 * query string has no reason to. Inferring it from the response rather than
 * from a hardcoded per-resource list means this heals itself the day the
 * lagging endpoint learns to page — no stale table to update.
 */
function serverPaged(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }

  const meta = (body as { meta?: unknown }).meta;

  return (
    typeof meta === "object" &&
    meta !== null &&
    typeof (meta as { limit?: unknown }).limit === "number"
  );
}

/**
 * Apply limit/offset ourselves when the server did not. Slices whichever
 * array the body carries (`data` on every current endpoint) and leaves the
 * rest of the body untouched. Best effort by design: the server only ever
 * returns a bounded window, so a client-side offset can only reach rows
 * inside that window — still better than silently returning them all.
 */
function pageClientSide(body: unknown, query: LedgerQuery): unknown {
  const start = query.offset ?? 0;

  if (Array.isArray(body)) {
    return body.slice(start, start + (query.limit ?? body.length));
  }

  if (!body || typeof body !== "object") {
    return body;
  }

  const record = body as Record<string, unknown>;
  const paged: Record<string, unknown> = { ...record };

  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      paged[key] = value.slice(start, start + (query.limit ?? value.length));
      break;
    }
  }

  return paged;
}

export function buildQueryString(query: LedgerQuery): string {
  const params = new URLSearchParams();

  // Clamped rather than rejected: an agent asking for 10,000 rows wants "all of
  // them", and answering with an error instead of the first hundred is a worse
  // answer to that question.
  if (query.limit !== undefined) {
    params.set("limit", String(Math.min(Math.max(query.limit, 1), 100)));
  }

  if (query.offset !== undefined) {
    params.set("offset", String(Math.max(query.offset, 0)));
  }

  if (query.status) {
    params.set("status", query.status);
  }

  const encoded = params.toString();

  return encoded ? `?${encoded}` : "";
}

export async function queryLedger(
  client: ApiClient,
  query: LedgerQuery,
): Promise<LedgerResult> {
  const definition = LEDGER_RESOURCES[query.resource];
  const path = `${definition.path}${buildQueryString(query)}`;

  const result = await client.request(
    path,
    {},
    { authenticated: definition.authenticated },
  );

  const pagingRequested = query.limit !== undefined || query.offset !== undefined;
  const paged = serverPaged(result.body);
  const body =
    pagingRequested && result.ok && !paged
      ? pageClientSide(result.body, query)
      : result.body;

  return {
    resource: query.resource,
    path,
    status: result.status,
    ok: result.ok,
    latencyMs: result.latencyMs,
    rowCount: countRows(body),
    paging: pagingRequested && result.ok ? (paged ? "server" : "client") : null,
    body,
  };
}
