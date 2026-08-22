import { expect, test } from "@playwright/test";

/**
 * Visual regression, scoped to surfaces that do not depend on live data.
 *
 * The gap this closes: every other test asserts something is *present*. None
 * would notice a layout silently breaking — which is exactly the class of
 * defect found by hand on this platform twice in one week. A password field
 * overflowed its column and slid under the card beside it; the header pushed
 * the document wider than a phone viewport. Both passed every functional test
 * while looking wrong, and both were in the chrome, which is precisely what is
 * captured below.
 *
 * What is deliberately NOT captured: the dashboard and ledger pages. Their
 * height is a function of how many rows the database holds, so a snapshot
 * taken against a developer's database can never match one taken against a
 * freshly seeded CI database — the first CI run proved it, 1488px against
 * 1422px. Masking the values does not help, because the row count changes the
 * geometry rather than the pixels inside it. A visual suite that fails
 * whenever the ledger moves is a visual suite people learn to ignore, and an
 * ignored suite is worse than no suite: it is a green tick that means nothing.
 *
 * Chromatic is the hosted version of this idea, and it solves the same problem
 * the same way — by pinning components to fixed inputs rather than pointing a
 * camera at production data.
 */

const WCAG_SAFE_MASK_NOTE = "no masks needed: these surfaces carry no live data";

test.describe("desktop chrome", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the sign-in page is unchanged", async ({ page }) => {
    // Entirely static: heading, both fields, the eye toggle, the published
    // reviewer credentials. This is the page where the overflow bug lived.
    await page.goto("/login?lang=en");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("login-desktop.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("the sidebar is unchanged", async ({ page }) => {
    await page.goto("/?lang=en");
    await page.waitForLoadState("networkidle");

    // The rail itself carries no ledger figures — brand, sandbox badge,
    // destinations, build box.
    await expect(page.getByRole("navigation", { name: /primary navigation/i })).toHaveScreenshot(
      "sidebar.png",
      { animations: "disabled" },
    );
  });
});

test.describe("phone chrome", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the sign-in page is unchanged on a phone", async ({ page }) => {
    await page.goto("/login?lang=en");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("login-phone.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("the navigation drawer is unchanged", async ({ page }) => {
    // The drawer did not exist a day ago; this is the surface most likely to
    // drift, and it is entirely static.
    await page.goto("/?lang=en");
    await page.getByRole("button", { name: "Primary navigation" }).click();

    const drawer = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(drawer).toBeVisible();

    await expect(drawer).toHaveScreenshot("mobile-drawer.png", { animations: "disabled" });
  });

  test("the header does not overflow a phone", async ({ page }) => {
    // Not a snapshot: an assertion. The header bug was a document 124px wider
    // than the viewport, and a number is a better guard for that than an
    // image — it cannot drift with a font update, and it says what is wrong.
    await page.goto("/?lang=en");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      overflow.scrollWidth,
      `document is ${overflow.scrollWidth - overflow.clientWidth}px wider than the viewport`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

test(`note: ${WCAG_SAFE_MASK_NOTE}`, () => {
  // A placeholder assertion documenting the scoping decision above in a place
  // a reader of the test list will see it.
  expect(WCAG_SAFE_MASK_NOTE).toContain("no live data");
});
