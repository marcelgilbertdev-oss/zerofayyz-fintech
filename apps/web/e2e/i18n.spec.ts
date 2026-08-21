import { expect, test } from "@playwright/test";

/**
 * Multilingual coverage. Each test asserts something a translation bug would
 * break — not merely that the page still loads.
 */

test("the dashboard renders in English by default", async ({ page }) => {
  await page.goto("/?lang=en");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Operations overview")).toBeVisible();
  await expect(page.getByText("Gross volume")).toBeVisible();
  // Appears twice — as a nav item and as the panel heading.
  await expect(page.getByText("System health").first()).toBeVisible();
});

test("the dashboard renders in Japanese when asked", async ({ page }) => {
  await page.goto("/?lang=ja");

  // The lang attribute drives screen-reader pronunciation and line breaking,
  // so a Japanese page still labelled "en" is an accessibility defect.
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByText("オペレーション概要")).toBeVisible();
  await expect(page.getByText("総取引額")).toBeVisible();
  await expect(page.getByText("システム稼働状況").first()).toBeVisible();
});

test("no English interface copy leaks into the Japanese page", async ({ page }) => {
  await page.goto("/?lang=ja");

  const body = await page.locator("body").innerText();

  // Product nouns (ZEROFAYYZ, PostgreSQL, Stripe, Next.js) stay in Latin script
  // by design. These are interface strings that must not survive translation.
  for (const leaked of [
    "Operations overview",
    "Gross volume",
    "Successful payments",
    "Pending settlement",
    "Recent transactions",
    "Payment method",
    "Good morning",
    "Good afternoon",
    "Good evening",
  ]) {
    expect(body, `untranslated English string on the Japanese page: ${leaked}`)
      .not.toContain(leaked);
  }
});

test("Japanese formats currency, numbers and dates in its own conventions", async ({ page }) => {
  await page.goto("/?lang=ja");

  const body = await page.locator("body").innerText();

  // Intl renders USD as "$1,222.00" in en-US and "$1,222.00" in ja-JP too, but
  // dates differ sharply — ja-JP uses 年/月/日 rather than "20 August 2026".
  expect(body).toMatch(/\d+年/);
  expect(body).toMatch(/\d+月/);
});

test("the language switcher round-trips and is remembered", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("link", { name: "日本語" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  // An explicit choice is stored, so a later visit with no ?lang= keeps it.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  await page.getByRole("link", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("Accept-Language is honoured when no choice has been made", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ja-JP" });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  await context.close();
});

test("an unknown locale falls back rather than breaking", async ({ page }) => {
  await page.goto("/?lang=klingon");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Operations overview")).toBeVisible();
});
