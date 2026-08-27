/**
 * Browser-level steps. Only the scenarios that are genuinely about rendering
 * open a page — everything else asserts at the API, where failures are exact.
 */

import assert from "node:assert/strict";

import { Then, When } from "@cucumber/cucumber";

import { WEB_URL, type PlatformWorld } from "../support/world.js";

When("a visitor opens the dashboard", async function (this: PlatformWorld) {
  const page = await this.page();
  await page.goto(WEB_URL, { waitUntil: "networkidle" });
});

Then(
  "every yen amount on the page is shown without a decimal fraction",
  async function (this: PlatformWorld) {
    const page = await this.page();
    const text = await page.locator("body").innerText();

    // Both the narrow (¥) and fullwidth (￥) signs count: Intl renders JPY
    // differently across ICU versions, and the platform treats that as the
    // formatter's choice, not a bug.
    const amounts = text.match(/[¥￥][\d,.]+/g) ?? [];
    assert.ok(amounts.length > 0, "the dashboard should display at least one yen amount");

    const fractional = amounts.filter((amount) => /\.\d/.test(amount));
    assert.deepEqual(
      fractional,
      [],
      `yen must have no decimal fraction, but the page shows: ${fractional.join(", ")}`,
    );
  },
);
