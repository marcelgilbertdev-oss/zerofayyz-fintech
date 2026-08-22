import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated accessibility checks against WCAG 2.1 A and AA.
 *
 * Automation catches roughly a third of real accessibility problems — contrast,
 * missing names, structural errors. It cannot judge whether a label is
 * *meaningful*. So this is a floor, not a certificate, and the manual charter in
 * docs/QUALITY_STRATEGY.md carries the rest.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("the English dashboard has no detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/?lang=en");

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

  // Print the rule ids so a failure is actionable from CI output alone.
  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
  ).toEqual([]);
});

test("the Japanese dashboard has no detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/?lang=ja");

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
  ).toEqual([]);
});

test("every interactive control is reachable by keyboard", async ({ page }) => {
  await page.goto("/?lang=en");

  // Tab until the payment button holds focus. If it is unreachable this fails
  // rather than hanging, and a mouse-only control is an accessibility defect.
  let reached = false;

  for (let index = 0; index < 25 && !reached; index += 1) {
    await page.keyboard.press("Tab");
    reached = await page
      .getByRole("button", { name: /test payment/i })
      .evaluate((node) => node === document.activeElement)
      .catch(() => false);
  }

  expect(reached, "the test payment button was not reachable by keyboard").toBe(true);
});

test("the language switcher exposes its current selection to assistive tech", async ({ page }) => {
  await page.goto("/?lang=ja");

  const active = page.getByRole("link", { name: "日本語" });

  // aria-current is how a screen reader announces which option is active;
  // colour alone conveys nothing to a non-sighted user.
  await expect(active).toHaveAttribute("aria-current", "true");
});

test("the sidebar marks the current page for assistive tech", async ({ page }) => {
  // This test used to assert the PLANNED items were genuinely disabled. Every
  // destination is real now, so the assertion evolves with the product: the
  // active item carries aria-current, which is what a screen reader needs to
  // answer "where am I".
  await page.goto("/payments?lang=en");

  const nav = page.getByRole("navigation", { name: /primary navigation/i });
  await expect(nav.getByRole("link", { name: /payments/i })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: /overview/i })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

/**
 * The same pages at a phone viewport.
 *
 * Everything above runs at the project's default desktop width, and that was a
 * blind spot rather than a choice: at desktop the ledger tables fit, so they
 * never become scroll containers, so `scrollable-region-focusable` never fired.
 * At phone width they scroll and a keyboard could not reach them — a WCAG A
 * failure that had been shipping under a green suite. Viewport is part of the
 * test matrix now, not an assumption.
 */
test.describe("at a phone viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [name, path] of [
    ["dashboard", "/?lang=en"],
    ["payments", "/payments?lang=en"],
    ["transactions", "/transactions?lang=en"],
    ["customers", "/customers?lang=en"],
    ["login", "/login?lang=en"],
  ] as const) {
    test(`the ${name} has no detectable WCAG A/AA violations on a phone`, async ({ page }) => {
      await page.goto(path);

      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

      expect(
        results.violations.map((violation) => `${violation.id}: ${violation.help}`),
      ).toEqual([]);
    });
  }

  test("the Japanese dashboard is clean on a phone too", async ({ page }) => {
    await page.goto("/?lang=ja");

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`),
    ).toEqual([]);
  });
});
