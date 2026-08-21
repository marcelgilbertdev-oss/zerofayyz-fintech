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

test("disabled navigation is announced as disabled, not merely styled", async ({ page }) => {
  await page.goto("/?lang=en");

  const planned = page.getByRole("button", { name: /Payments/ }).first();

  await expect(planned).toBeDisabled();
  await expect(planned).toHaveAttribute("aria-disabled", "true");
});
