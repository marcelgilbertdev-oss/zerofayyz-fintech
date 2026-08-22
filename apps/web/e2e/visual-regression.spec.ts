import { expect, test } from "@playwright/test";

/**
 * Visual regression.
 *
 * The gap this closes: every other test asserts that something is *present*.
 * None of them notice when a layout silently breaks — which is exactly the
 * class of defect found by hand on this platform twice in one week (a password
 * field sliding under the card beside it, and a header pushing the document
 * wider than a phone). Both passed every functional test while looking wrong.
 *
 * Chromatic is the hosted version of this idea. Playwright's own snapshot
 * comparison does the same job for a single-repo project without a second SaaS
 * account, and it runs in the same pipeline as everything else.
 *
 * Two things keep this from being a flaky-test generator:
 *
 *   - Animations are disabled and the network is idle before capture, so a
 *     diff means a layout change rather than a timing accident.
 *   - Live data is masked. Every figure on this dashboard comes from a real
 *     database that changes whenever anyone runs a test payment; comparing
 *     those pixels would fail for reasons that have nothing to do with layout.
 *     What is being asserted is the *shape* of the page, not its contents.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const [page_, path] of [
      ["dashboard", "/?lang=en"],
      ["payments", "/payments?lang=en"],
      ["login", "/login?lang=en"],
    ] as const) {
      test(`${page_} layout is unchanged`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");

        await expect(page).toHaveScreenshot(`${page_}-${viewport.name}.png`, {
          fullPage: true,
          animations: "disabled",
          // Live figures and relative timestamps are masked rather than
          // compared: they change with every test payment, and a suite that
          // fails because the ledger moved is a suite people learn to ignore.
          mask: [
            page.locator("table"),
            page.getByLabel(/key metrics|payment metrics/i),
            page.locator("[data-live]"),
          ],
          // A small tolerance for font rasterisation differences between the
          // machine that recorded the baseline and the one replaying it.
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  });
}

test.describe("the mobile drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("open drawer layout is unchanged", async ({ page }) => {
    await page.goto("/?lang=en");
    await page.getByRole("button", { name: "Primary navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeVisible();

    await expect(page.getByRole("dialog", { name: "Primary navigation" })).toHaveScreenshot(
      "mobile-drawer.png",
      { animations: "disabled", maxDiffPixelRatio: 0.02 },
    );
  });
});
