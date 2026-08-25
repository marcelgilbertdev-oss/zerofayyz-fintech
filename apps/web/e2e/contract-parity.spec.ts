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
  "4200", "50", "49", "1500000", "1500001", "1,500,000", "¥4,200", "￥300",
  "42.00", "17.35", "0", "-5", "", "   ", "abc", "1e3", "7", "7.5",
];

test("the dashboard's money parsing matches the shared contract exactly", () => {
  for (const input of CASES) {
    expect(dashboardParse(input), `disagreement on ${JSON.stringify(input)}`).toBe(
      contractParse(input),
    );
  }
});

test("yen amounts are integers, and decimals are refused as non-amounts", () => {
  // JPY is zero-decimal: a minor unit is one yen, and "17.35" is not an
  // amount of yen at all. The float hazard the old cents test guarded
  // (17.35 * 100 being 1734.999…) cannot arise when nothing is multiplied.
  expect(contractParse("17350")).toBe(17350);
  expect(contractParse("¥4,200")).toBe(4200);
  expect(contractParse("17.35")).toBe(null);
  expect(contractParse("0.70")).toBe(null);
});
