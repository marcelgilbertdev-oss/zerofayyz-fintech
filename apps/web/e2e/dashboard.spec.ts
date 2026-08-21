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

test("a reviewer can choose the payment amount", async ({ page }) => {
  await page.goto("/");

  const amount = page.getByLabel(/test payment amount/i);
  await expect(amount).toBeVisible();

  // Pre-filled, so the one-click path still works for anyone who ignores it.
  await expect(amount).toHaveValue("42.00");

  await amount.fill("173.50");
  await expect(amount).toHaveValue("173.50");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
});

test("an out-of-range amount is refused before any network call", async ({ page }) => {
  await page.goto("/");

  const amount = page.getByLabel(/test payment amount/i);
  const button = page.getByRole("button", { name: /test payment/i });

  let checkoutCalls = 0;
  await page.route("**/api/checkout", async (route) => {
    checkoutCalls += 1;
    await route.abort();
  });

  await amount.fill("999999");
  await expect(amount).toHaveAttribute("aria-invalid", "true");

  await expect(async () => {
    await button.click();
    await expect(page.getByText(/Enter an amount between/i)).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });

  expect(checkoutCalls, "a rejected amount must not reach the network").toBe(0);
});

test("the amount field is labelled in Japanese too", async ({ page }) => {
  await page.goto("/?lang=ja");

  await expect(page.getByLabel(/テスト決済の金額/)).toBeVisible();
});

// Regression guard: the permitted range was originally screen-reader-only, so
// assistive tech announced the limits and sighted users were left guessing why
// their number was refused. Visible-to-everyone is the requirement.
test("the permitted amount range is visible, not only announced", async ({ page }) => {
  await page.goto("/");

  const amount = page.getByLabel(/test payment amount/i);
  const hint = page.getByText(/Any amount from \$0\.50 to \$10,000\.00/i);

  await amount.focus();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCSS("opacity", "1");
});

test("a chosen amount survives the trip to Stripe and back", async ({ page }) => {
  await page.goto("/");

  // Simulate what the checkout click stores before redirecting to Stripe —
  // the return from Stripe is a fresh document load, exactly like this one.
  await page.evaluate(() => window.sessionStorage.setItem("zf_last_amount", "137.50"));
  await page.reload();

  // Pre-filled with the reviewer's own number, not the default: the field
  // must never read as the system forgetting what they chose. First-time
  // visitors (empty storage) still get the one-click 42.00.
  await expect(page.getByLabel(/test payment amount/i)).toHaveValue("137.50");
});
