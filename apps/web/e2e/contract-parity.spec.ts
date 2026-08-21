import { expect, test } from "@playwright/test";

import { toMinorUnits as dashboardParse } from "../src/components/checkout-button";
import { toMinorUnits as contractParse } from "../../../packages/api-contract/schemas";

/**
 * The dashboard carries its own copy of the money-parsing rule because Vercel
 * builds this app from a root that never uploads `packages/`. A copy that
 * nothing checks is a copy that drifts, so this test holds the two together.
 *
 * It lives in the Playwright suite on purpose: these tests run in CI and
 * locally, never inside a Vercel build, so they may import across the boundary
 * the bundler cannot cross.
 *
 * That boundary is also why e2e/ is excluded from the main tsconfig: the Next
 * build typechecks everything the tsconfig includes, follows this file's
 * import into packages/api-contract, and fails on Vercel where that package's
 * dependencies are never installed — which is exactly how this file broke two
 * production deploys before anyone noticed. CI typechecks e2e/ through
 * tsconfig.e2e.json, where the dependencies exist.
 */
const CASES = [
  "42.00", "0.50", "0.49", "10000.00", "10000.01", "1,234.56", "$17.35",
  "17.355", "0", "-5", "", "   ", "abc", "1e3", "99.999", "7", "7.5",
];

test("the dashboard's money parsing matches the shared contract exactly", () => {
  for (const input of CASES) {
    expect(dashboardParse(input), `disagreement on ${JSON.stringify(input)}`).toBe(
      contractParse(input),
    );
  }
});

test("floating-point cents survive the round trip", () => {
  // 17.35 * 100 is 1734.9999999999998; anything that multiplies floats fails here.
  expect(contractParse("17.35")).toBe(1735);
  expect(contractParse("0.70")).toBe(70);
  expect(contractParse("8.29")).toBe(829);
});
