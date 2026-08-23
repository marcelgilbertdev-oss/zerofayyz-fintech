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

test("the drawer declares its stacking order rather than relying on DOM order", async ({
  page,
}) => {
  // A phone-only rendering bug that no desktop browser reproduces.
  //
  // The backdrop uses backdrop-blur, which promotes it to its own compositing
  // layer. The panel had no z-index, so its position was implied by DOM order —
  // which Chromium honours and iOS Safari, once a sibling is promoted, does
  // not. On an iPhone the blurred page composited over the drawer's opaque
  // background while its text kept painting above, and the whole menu was
  // unreadable. Found on a real phone, not by this suite.
  //
  // The symptom cannot be reproduced here, so this pins the invariant instead:
  // both siblings state their order explicitly, and the panel is above.
  await page.goto("/customers?lang=en");
  await page.getByRole("button", { name: "Primary navigation" }).click();

  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer).toBeVisible();

  const layers = await drawer.evaluate((panel) => {
    const backdrop = panel.parentElement?.querySelector("button[aria-hidden='true']");

    return {
      panelZ: getComputedStyle(panel).zIndex,
      backdropZ: backdrop ? getComputedStyle(backdrop).zIndex : null,
      // An opaque panel is the other half of the contract: even correctly
      // stacked, a translucent background would show the page through it.
      panelBackground: getComputedStyle(panel).backgroundColor,
    };
  });

  expect(layers.panelZ).not.toBe("auto");
  expect(layers.backdropZ).not.toBe("auto");
  expect(Number(layers.panelZ)).toBeGreaterThan(Number(layers.backdropZ));
  // rgb() with no alpha channel — anything with transparency fails here.
  expect(layers.panelBackground).toMatch(/^rgb\(/);
});

test("the drawer escapes every filtered ancestor, so it is a real overlay", async ({
  page,
}) => {
  // The bug this exists for, and the reason the previous fix was not enough.
  //
  // MobileNav sits inside the page header, and that header carries
  // `bg-[#07110f]/80 backdrop-blur-xl`. An element with a backdrop-filter
  // establishes a stacking context *and* a containing block for fixed-position
  // descendants, so a drawer rendered in place is not a top-level overlay at
  // all — it is composited inside a parent that is 80% transparent and blurring
  // what sits behind it. On an iPhone the page showed straight through the
  // menu. The panel's own background was opaque the whole time.
  //
  // Giving the panel and scrim explicit z-indexes did not fix it: that ordered
  // two siblings correctly *inside* the trap. The overlay has to leave the
  // subtree, which is what the portal to document.body does.
  //
  // Chromium composites the nested case in a way that happens to look correct,
  // so this asserts the structure rather than the appearance — and structure is
  // what actually differs between the broken and fixed versions.
  await page.goto("/?lang=en");
  await page.getByRole("button", { name: "Primary navigation" }).click();

  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer).toBeVisible();

  const ancestry = await drawer.evaluate((panel) => {
    const offenders: string[] = [];
    let node = panel.parentElement;

    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      // Any of these three creates a containing block for fixed descendants
      // and would re-trap the overlay.
      const traps =
        style.backdropFilter !== "none" ||
        style.filter !== "none" ||
        style.transform !== "none";

      if (traps) {
        offenders.push(`${node.tagName.toLowerCase()}.${node.className}`.slice(0, 80));
      }
      node = node.parentElement;
    }

    return { offenders, parentIsBody: panel.parentElement?.parentElement === document.body };
  });

  expect(ancestry.offenders).toEqual([]);
  expect(ancestry.parentIsBody).toBe(true);
});
