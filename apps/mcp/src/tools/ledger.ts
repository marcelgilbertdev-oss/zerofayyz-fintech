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

  return {
    resource: query.resource,
    path,
    status: result.status,
    ok: result.ok,
    latencyMs: result.latencyMs,
    rowCount: countRows(result.body),
    body: result.body,
  };
}
