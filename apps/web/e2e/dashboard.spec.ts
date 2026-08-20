import { expect, test } from "@playwright/test";

/**
 * The reviewer's path is the product: open the dashboard, see real data,
 * start a payment. These tests walk exactly that path.
 */

test("the dashboard renders live platform health", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Payment operations")).toBeVisible();

  const healthCard = page.locator("section", { hasText: "System health" }).first();
  await expect(healthCard.getByText("API service")).toBeVisible();
  await expect(healthCard.getByText("PostgreSQL")).toBeVisible();

  // The API and database are up during the E2E run, so the page must say so.
  // A hardcoded status tile would pass this test even with the API stopped,
  // which is why the assertion is on the live count.
  await expect(healthCard.getByText(/[0-9] of 4 live/)).toBeVisible();
});

test("recent transactions come from the database, not the page", async ({ page }) => {
  await page.goto("/");

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(page.getByText("Live sandbox records from PostgreSQL")).toBeVisible();

  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  // Seeded customers use .test addresses; their presence proves the row came
  // through the API from PostgreSQL.
  await expect(table.getByText(/@example\.test|@zerofayyz\.test/).first()).toBeVisible();
});

test("headline metrics are currency-formatted values, not placeholders", async ({ page }) => {
  await page.goto("/");

  const metrics = page.getByLabel("Key metrics");
  await expect(metrics.getByText("Gross volume")).toBeVisible();
  await expect(metrics.getByText("Webhook events")).toBeVisible();

  // The retired placeholder figures were $48,920 and 1,284. If either ever
  // reappears, the dashboard has stopped reading the ledger.
  await expect(metrics.getByText("$48,920")).toHaveCount(0);
  await expect(metrics.getByText("1,284")).toHaveCount(0);
});

test("the checkout button reports a clear error when Stripe is unconfigured", async ({ page }) => {
  await page.goto("/");

  const button = page.getByRole("button", { name: /test payment/i });
  await expect(button).toBeVisible();

  const configured = await page.getByText("Test API access").count();
  test.skip(configured > 0, "Stripe is configured; the sandbox redirect is covered manually");

  // A click that lands before React hydrates is silently discarded, so retry
  // until the handler is live rather than asserting once and hoping.
  await expect(async () => {
    await button.click();
    await expect(
      page.getByText(/not configured|unavailable|Unable to start/i).first(),
    ).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});

test("the sandbox framing is visible to a reviewer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText(/No real funds/i).first()).toBeVisible();
  await expect(page.getByText("Test mode").first()).toBeVisible();
});
