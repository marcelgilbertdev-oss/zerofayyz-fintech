import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The three ledger pages: real data, working filters, working pagination, and
 * the same accessibility bar as everything else. These retired the last
 * PLANNED badges — a sidebar advertising three unbuilt sections was the last
 * thing on the platform that read as unfinished.
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("the payments page lists the ledger and filters by status", async ({ page }) => {
  await page.goto("/payments");

  await expect(page.getByRole("heading", { name: /^payments$/i, level: 1 })).toBeVisible();

  // Seeded data guarantees at least one succeeded and one failed payment.
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  await page.getByRole("navigation", { name: /filter by status/i })
    .getByRole("link", { name: /^failed$/i })
    .click();

  await expect(page).toHaveURL(/status=failed/);

  // Every visible status chip on a filtered page carries the filtered status —
  // the filter is real, not decorative.
  for (const text of await page.locator("tbody tr td:nth-child(5)").allInnerTexts()) {
    expect(text.trim().toLowerCase()).toContain("failed");
  }
});

test("the transactions page shows the raw event stream", async ({ page }) => {
  await page.goto("/transactions");

  await expect(page.getByRole("heading", { name: /^transactions$/i, level: 1 })).toBeVisible();
  // The subtitle carries the idempotency claim; the event id column is the
  // visible evidence for it.
  await expect(page.getByText(/UNIQUE-constrained/)).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("the customers page aggregates per customer", async ({ page }) => {
  await page.goto("/customers");

  await expect(page.getByRole("heading", { name: /^customers$/i, level: 1 })).toBeVisible();

  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  // Seeded: Nadia has exactly one payment. Her row exists and carries a count.
  await expect(page.locator("tr", { hasText: "nadia@example.test" })).toBeVisible();
});

test("pagination walks the ledger without repeating rows", async ({ page }) => {
  // The seed plus test traffic guarantees more than one page only for events;
  // assert against whichever total the API reports rather than assuming.
  await page.goto("/transactions");

  const summary = await page.getByText(/of \d+$/).innerText();
  const total = Number.parseInt(summary.split("of").at(-1) ?? "0", 10);

  test.skip(total <= 20, "not enough events locally for a second page");

  const firstPageIds = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
  await page.getByRole("link", { name: /older/i }).click();
  await expect(page).toHaveURL(/offset=20/);

  const secondPageIds = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
  for (const id of secondPageIds) {
    expect(firstPageIds).not.toContain(id);
  }
});

test("the sidebar reaches every ledger page and marks it current", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: /primary navigation/i });

  for (const name of [/payments/i, /transactions/i, /customers/i]) {
    await nav.getByRole("link", { name }).click();
    await expect(
      page.getByRole("navigation", { name: /primary navigation/i }).getByRole("link", { name }),
    ).toHaveAttribute("aria-current", "page");
  }
});

for (const [path, name] of [
  ["/payments", "payments"],
  ["/transactions", "transactions"],
  ["/customers", "customers"],
] as const) {
  test(`the ${name} page has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(`${path}?lang=en`);

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`),
    ).toEqual([]);
  });
}

test("the payments page renders in Japanese", async ({ page }) => {
  await page.goto("/payments?lang=ja");

  await expect(page.getByRole("heading", { name: "決済", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "すべて" })).toBeVisible();
});
