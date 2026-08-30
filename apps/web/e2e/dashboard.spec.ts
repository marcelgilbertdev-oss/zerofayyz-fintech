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
  //
  // The total is NOT pinned to a number. It was "of 4" and broke the moment the
  // panel started showing the two integrations the API had been reporting all
  // along — a test asserting a total it does not derive is a test that has to be
  // edited every time the truth changes. What matters is that the badge counts
  // the rows actually rendered, so this reads both and compares them.
  const badge = healthCard.getByText(/\d+ of \d+ live/);
  await expect(badge).toBeVisible();

  // textContent with whitespace collapsed: innerText can come back with the
  // badge's own line breaks, and the match then silently yields undefined —
  // which reads as "expected 6, received NaN" rather than as a parse problem.
  const badgeText = ((await badge.textContent()) ?? "").replace(/\s+/g, " ").trim();
  const match = badgeText.match(/(\d+) of (\d+) live/);
  expect(match, `badge did not read "N of M live": ${badgeText}`).not.toBeNull();

  const live = Number(match![1]);
  const total = Number(match![2]);
  const rowCount = await healthCard.getByRole("listitem").count();

  // The total must be the number of rows actually rendered. It was hardcoded to
  // 4 while the panel showed a subset of what the API reported, so the badge
  // could claim a total the list did not contain.
  expect(total).toBe(rowCount);
  expect(live).toBeGreaterThan(0);
  expect(live).toBeLessThanOrEqual(total);
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
  await expect(amount).toHaveValue("4200");

  await amount.fill("17350");
  await expect(amount).toHaveValue("17350");
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

  await amount.fill("9999999");
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
  // Matched on the range alone, not the whole sentence. The hint also carries
  // the sandbox test card, and that wording will change again — a test that
  // pins every word of a string fails for edits that break nothing.
  const hint = page.getByText(/¥50.*¥1,500,000/i);

  await amount.focus();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCSS("opacity", "1");
});

test("a chosen amount survives the trip to Stripe and back", async ({ page }) => {
  await page.goto("/");

  // Simulate what the checkout click stores before redirecting to Stripe —
  // the return from Stripe is a fresh document load, exactly like this one.
  await page.evaluate(() => window.sessionStorage.setItem("zf_last_amount", "13750"));
  await page.reload();

  // Pre-filled with the reviewer's own number, not the default: the field
  // must never read as the system forgetting what they chose. First-time
  // visitors (empty storage) still get the one-click ¥4,200.
  await expect(page.getByLabel(/test payment amount/i)).toHaveValue("13750");
});
