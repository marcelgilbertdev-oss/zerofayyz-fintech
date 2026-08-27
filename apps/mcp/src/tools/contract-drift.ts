/**
 * Contract-drift detection.
 *
 * The clients compile against a *copy* of the API's types. Nothing at build
 * time proves the deployed API still matches that copy — the Zod contract turns
 * that assumption into a runtime check at the browser's edge, but only once a
 * user has already loaded the page.
 *
 * This tool moves that check earlier: it validates live API responses against
 * the same shared schemas, on demand and in CI, so drift is a failing job
 * rather than a support ticket.
 */

import type { ZodType } from "zod";

import type { ApiClient } from "../api-client.js";
import {
  auditLogsSchema,
  healthSchema,
  metricsSchema,
  transactionsSchema,
} from "../schemas.js";

export type DriftFinding = {
  endpoint: string;
  status: number;
  latencyMs: number;
  valid: boolean;
  /**
   * True when the endpoint could not be checked at all — no operator
   * credentials, for instance. Distinct from `valid: false`, which means the
   * endpoint answered and its answer disagreed with the contract. Reporting a
   * missing credential as drift is how a quality tool teaches people to ignore
   * it: the first thing anyone learns is that one red line is always red.
   */
  skipped: boolean;
  /** Field-level failures, formatted as `path: message`. Empty when valid. */
  problems: string[];
};

export type DriftReport = {
  apiReachable: boolean;
  checked: number;
  drifted: number;
  skipped: number;
  findings: DriftFinding[];
  summary: string;
};

type ContractCheck = {
  endpoint: string;
  schema: ZodType;
  authenticated: boolean;
};

/**
 * Every endpoint the shared contract makes a promise about. Adding a schema to
 * `packages/api-contract` without adding it here would leave a promise nobody
 * verifies, so this list is asserted against the contract's exports in the tests.
 */
export const CONTRACT_CHECKS: ContractCheck[] = [
  { endpoint: "/api/v1/health", schema: healthSchema, authenticated: false },
  { endpoint: "/api/v1/metrics", schema: metricsSchema, authenticated: false },
  {
    endpoint: "/api/v1/transactions",
    schema: transactionsSchema,
    authenticated: false,
  },
  {
    endpoint: "/api/v1/admin/audit-logs",
    schema: auditLogsSchema,
    authenticated: true,
  },
];

export function formatIssues(error: unknown): string[] {
  const issues = (error as { issues?: Array<{ path: unknown[]; message: string }> })
    .issues;

  if (!Array.isArray(issues)) {
    return [String(error)];
  }

  return issues.map((issue) => {
    // A drifted top-level response has an empty path; calling that "" in a
    // report is useless to whoever has to fix it.
    const path = issue.path.length > 0 ? issue.path.join(".") : "(response root)";
    return `${path}: ${issue.message}`;
  });
}

export async function checkContractDrift(
  client: ApiClient,
  checks: ContractCheck[] = CONTRACT_CHECKS,
): Promise<DriftReport> {
  const findings: DriftFinding[] = [];
  let apiReachable = false;

  for (const check of checks) {
    let result;

    try {
      result = await client.request(
        check.endpoint,
        {},
        { authenticated: check.authenticated },
      );
    } catch (error) {
      const message = (error as Error).message;
      // A configuration gap is not a drift signal. Anything else — DNS, TLS,
      // connection refused — genuinely is a failure to verify the contract.
      const unconfigured = message.includes("No operator credentials configured");

      findings.push({
        endpoint: check.endpoint,
        status: 0,
        latencyMs: 0,
        valid: false,
        skipped: unconfigured,
        problems: [unconfigured ? message : `request failed: ${message}`],
      });
      continue;
    }

    apiReachable = true;

    if (!result.ok) {
      findings.push({
        endpoint: check.endpoint,
        status: result.status,
        latencyMs: result.latencyMs,
        valid: false,
        skipped: false,
        problems: [`expected a 2xx response, got ${result.status}`],
      });
      continue;
    }

    const parsed = check.schema.safeParse(result.body);

    findings.push({
      endpoint: check.endpoint,
      status: result.status,
      latencyMs: result.latencyMs,
      valid: parsed.success,
      skipped: false,
      problems: parsed.success ? [] : formatIssues(parsed.error),
    });
  }

  const skipped = findings.filter((finding) => finding.skipped).length;
  const drifted = findings.filter(
    (finding) => !finding.valid && !finding.skipped,
  ).length;
  const verified = findings.length - skipped;
  const skipNote = skipped > 0 ? ` ${skipped} skipped (not configured).` : "";

  return {
    apiReachable,
    checked: findings.length,
    drifted,
    skipped,
    findings,
    summary:
      drifted === 0
        ? `All ${verified} verified endpoints match the shared contract.${skipNote}`
        : `${drifted} of ${verified} verified endpoints have drifted from the shared contract.${skipNote}`,
  };
}
