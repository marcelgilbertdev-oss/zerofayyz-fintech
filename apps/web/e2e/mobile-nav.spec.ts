import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The platform's navigation below the desktop breakpoint.
 *
 * The sidebar is `hidden lg:flex`, so before this drawer existed a phone had no
 * navigation at all — the overview and nothing else. Many reviewers open a
 * portfolio link on their phone, so these run at a real phone viewport rather
 * than asserting classes at desktop width.
 */

const PHONE = { width: 390, height: 844 };
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ viewport: PHONE });

test("every primary destination is reachable from a phone", async ({ page }) => {
  await page.goto("/?lang=en");

  // The regression that mattered: zero reachable links, not a styling nit.
  await page.getByRole("button", { name: "Primary navigation" }).click();

  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer).toBeVisible();

  for (const label of ["Overview", "Payments", "Transactions", "Customers", "Admin console"]) {
    await expect(drawer.getByRole("link", { name: label })).toBeVisible();
  }
});

test("the drawer marks where you are, and navigates there", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.getByRole("button", { name: "Primary navigation" }).click();

  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await drawer.getByRole("link", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/payments/);

  // And the destination knows it is the current section.
  await page.getByRole("button", { name: "Primary navigation" }).click();
  await expect(
    page.getByRole("dialog", { name: "Primary navigation" }).getByRole("link", { name: "Payments" }),
  ).toHaveAttribute("aria-current", "page");
});

test("Escape closes the drawer and returns focus to the trigger", async ({ page }) => {
  await page.goto("/?lang=en");

  const trigger = page.getByRole("button", { name: "Primary navigation" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeHidden();
  // Closing must not dump the caret at the top of the document.
  await expect(trigger).toBeFocused();
});

test("opening the drawer moves focus to the first destination", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.getByRole("button", { name: "Primary navigation" }).click();

  await expect(
    page.getByRole("dialog", { name: "Primary navigation" }).getByRole("link", { name: "Overview" }),
  ).toBeFocused();
});

test("the page behind cannot scroll while the drawer is open", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.getByRole("button", { name: "Primary navigation" }).click();

  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
});

test("the open drawer has no detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/?lang=en");
  await page.getByRole("button", { name: "Primary navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
  ).toEqual([]);
});

test("the phone-width dashboard never scrolls sideways", async ({ page }) => {
  await page.goto("/?lang=en");

  // Wide tables are allowed to scroll inside their own container; the page
  // body is not. This is the check that catches a stray fixed width.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

  expect(overflows).toBe(false);
});
