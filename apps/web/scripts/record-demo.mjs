/**
 * Records the reviewer's path through the platform as a video.
 *
 * Driven by Playwright rather than a screen recorder, for three reasons: the
 * pacing is deterministic, nothing depends on window framing or a steady hand,
 * and the video regenerates in a minute when the figures on screen change —
 * which they do every time someone tries the demo.
 *
 *   node scripts/record-demo.mjs  (from apps/web)                      # against the live deployment
 *   DEMO_BASE_URL=http://127.0.0.1:3000 node ...      # against a local stack
 *
 * Output: docs/portfolio/demo/*.webm  (convert to mp4 with ffmpeg if needed)
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.DEMO_BASE_URL ?? "https://zerofayyz-fintech.vercel.app";
const OUT = "../../docs/portfolio/demo";
const WIDTH = 1440;
const HEIGHT = 900;

// Sandbox test card. Documented in the README and printed on the checkout page;
// Stripe test mode rejects real cards, so nothing here can move money.
const CARD = { number: "4242424242424242", expiry: "1234", cvc: "123", name: "Portfolio Reviewer" };

/** A beat. Video needs dead air where a person would pause; tests never do. */
const beat = (page, ms) => page.waitForTimeout(ms);

/** Types at human speed so the viewer can follow what is being entered. */
const typeSlowly = (locator, text) => locator.pressSequentially(text, { delay: 90 });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    // 1 — the dashboard, live from PostgreSQL
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await beat(page, 3500);

    // 2 — let the metric tiles read
    const metrics = page.getByText("Gross volume").first();
    await metrics.scrollIntoViewIfNeeded();
    await beat(page, 5000);

    // 3 — the amount field, where the test card is named before you leave
    const amount = page.locator('input[type="number"], input[inputmode="numeric"]').first();
    if (await amount.count()) {
      await amount.click();
      await beat(page, 3000);
    }

    // 4 — hand off to Stripe
    await page.getByRole("button", { name: /Test payment/i }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await beat(page, 3000);

    // 5 — the sandbox notice sits above the pay button, where it is needed
    const notice = page.getByText(/Sandbox only/i).first();
    if (await notice.count()) {
      await notice.scrollIntoViewIfNeeded();
      await beat(page, 4000);
    }

    // 6 — pay
    await typeSlowly(page.locator('input[name="cardNumber"]'), CARD.number);
    await typeSlowly(page.locator('input[name="cardExpiry"]'), CARD.expiry);
    await typeSlowly(page.locator('input[name="cardCvc"]'), CARD.cvc);
    const nameField = page.locator('input[name="billingName"]');
    if (await nameField.count()) await typeSlowly(nameField, CARD.name);
    await beat(page, 1200);
    await page.getByTestId("hosted-payment-submit-button").click();

    // 7 — the wait IS the product. The webhook has to arrive and verify before
    //     anything is marked succeeded, so this pause is not dead time.
    await page.waitForURL(/checkout=success/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await beat(page, 8000);

    // 8 — the ledger now holds it
    const transactions = page.getByRole("link", { name: /Transactions/i }).first();
    if (await transactions.count()) {
      await transactions.click();
      await page.waitForLoadState("networkidle");
      await beat(page, 14000);
    }
  } finally {
    await context.close();          // the video is only written on close
    await browser.close();
  }
  console.log(`Recorded to ${OUT}/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
