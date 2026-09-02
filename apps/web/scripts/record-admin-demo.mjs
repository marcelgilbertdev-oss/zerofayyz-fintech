/**
 * Records the privileged half of the platform as a video: sign-in, the refund
 * queue and its four-eyes rule, and the append-only audit log.
 *
 * Companion to record-demo.mjs, which records the public payment path. That one
 * shows what anyone can do; this one shows what the login is for.
 *
 * It signs in as the PUBLISHED demo operator on purpose. Everything in this
 * video can be reproduced by whoever is watching it, using credentials printed
 * on the login page — which is the same reason the account exists at all. The
 * operator reads everything and changes nothing, so nothing here can be done to
 * the platform by someone following along.
 *
 *   node scripts/record-admin-demo.mjs   (from apps/web)
 *   DEMO_BASE_URL=http://127.0.0.1:3000 node ...        # against a local stack
 *
 * Output: docs/portfolio/demo/*.webm  (convert with ffmpeg)
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.DEMO_BASE_URL ?? "https://zerofayyz-fintech.vercel.app";
const OUT = "../../docs/portfolio/demo";
const WIDTH = 1440;
const HEIGHT = 900;

/** A beat. Video needs dead air where a person would pause; tests never do. */
const beat = (page, ms) => page.waitForTimeout(ms);

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
    // 1 — the public dashboard, so the cut has somewhere to start from
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await beat(page, 3000);

    // 2 — the one door on an otherwise open page
    await page.getByRole("link", { name: /Sign in/i }).first().click();
    await page.waitForLoadState("networkidle");
    await beat(page, 4000);

    // 2b — the password form is not the only door. A sign-in link can be
    //      emailed instead: single-use, fifteen minutes, and the database keeps
    //      only a hash of it. Shipped after this video was first recorded, which
    //      is the argument for a recorder that is code rather than a screen
    //      capture — it re-shoots itself.
    const magic = page.getByRole("button", { name: /sign-in link/i }).first();
    if (await magic.count()) {
      await magic.scrollIntoViewIfNeeded();
      await beat(page, 5000);
    }

    // 3 — the credentials are printed on the page. A reviewer should never have
    //     to ask anyone for access, so the button fills them in.
    const fill = page.getByRole("button", { name: /Fill these in for me/i });
    if (await fill.count()) {
      await fill.click();
      await beat(page, 2500);
    }
    await page.getByRole("button", { name: /^Sign in$/i }).click();
    await page.waitForLoadState("networkidle");
    await beat(page, 5000);

    // 4 — the refund queue: money moving backwards is the one action with a
    //     four-eyes rule, and the page says so rather than hiding it
    const refunds = page.getByRole("tab", { name: /Refunds/i }).or(
      page.getByRole("button", { name: /Refunds/i }),
    ).first();
    if (await refunds.count()) {
      await refunds.click();
      await page.waitForLoadState("networkidle");
      await beat(page, 8000);
    }

    const rule = page.getByText(/four-eyes|cannot be the one who approves/i).first();
    if (await rule.count()) {
      await rule.scrollIntoViewIfNeeded();
      await beat(page, 8000);
    }

    // 5 — the audit log: a history the application itself cannot rewrite.
    //     The tabs are links carrying ?tab=, so navigate rather than guessing
    //     at a role — an earlier take clicked nothing and recorded the wrong
    //     panel for nine seconds.
    await page.goto(`${BASE}/admin?tab=audit`, { waitUntil: "networkidle" });
    await beat(page, 3000);
    const auditHeading = page.getByText(/Audit log/i).first();
    if (await auditHeading.count()) {
      await auditHeading.scrollIntoViewIfNeeded();
    }
    await beat(page, 9000);

    // 6 — what this account is NOT allowed to see. The operator console states
    //     what is reserved for an administrator instead of quietly hiding it,
    //     and the API refuses those calls regardless of what the page renders.
    const reserved = page.getByText(/reserved|administrator|admin only/i).first();
    if (await reserved.count()) {
      await reserved.scrollIntoViewIfNeeded();
      await beat(page, 7000);
    }

    // 7 — sign out, so the video ends where it began
    const signOut = page.getByRole("button", { name: /Sign out/i }).first();
    if (await signOut.count()) {
      await signOut.click();
      await page.waitForLoadState("networkidle");
      await beat(page, 4000);
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
