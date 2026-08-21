import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The reviewer's second journey: through the published demo credentials into
 * the operator view. These run against the production build and a real API
 * with a real database — the same stack a recruiter reaches.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DEMO_EMAIL = "demo@zerofayyz.test";
const DEMO_PASSWORD = "view-the-ledger";

async function signInAsDemo(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(DEMO_EMAIL);
  await page.getByRole("textbox", { name: /^password$/i }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/admin");
}

test("visiting /admin signed out lands on the login page", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /admin console sign-in/i })).toBeVisible();
});

test("the demo credentials are published on the login page", async ({ page }) => {
  await page.goto("/login");

  // The whole point of the demo account: a reviewer should never have to ask.
  await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
  await expect(page.getByText(DEMO_PASSWORD)).toBeVisible();
});

test("a wrong password shows an error and stays on the page", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email address/i).fill(DEMO_EMAIL);
  await page.getByRole("textbox", { name: /^password$/i }).fill("not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  // getByRole("alert") alone is ambiguous here: Next.js injects its own
  // role="alert" route announcer into every page, so the locator must be
  // anchored to the message rather than the role.
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("the demo operator signs in, sees their tabs, and nothing above their role", async ({
  page,
}) => {
  await signInAsDemo(page);

  // The console is tabbed now: an operator gets Refunds and the audit log.
  const tabBar = page.getByRole("navigation", { name: /admin console/i });
  await expect(tabBar.getByRole("link", { name: /refunds/i })).toBeVisible();
  await expect(tabBar.getByRole("link", { name: /audit log/i })).toBeVisible();

  // And no tabs for what their role cannot read — the API refuses those with
  // 403 regardless; this asserts the page is honest instead of showing doors
  // that lead to errors.
  await expect(tabBar.getByRole("link", { name: /active sessions/i })).toHaveCount(0);
  await expect(tabBar.getByRole("link", { name: /^accounts$/i })).toHaveCount(0);
  await expect(page.getByText(/signed in as an operator/i)).toBeVisible();

  // The history lives one tab over.
  await tabBar.getByRole("link", { name: /audit log/i }).click();
  await expect(page.getByText("auth.login.succeeded").first()).toBeVisible();
});

test("their own login is the newest entry in the audit log they see", async ({ page }) => {
  await signInAsDemo(page);
  await page.goto("/admin?tab=audit");

  const auditRegion = page.getByRole("region", { name: /audit log/i });
  const firstAction = auditRegion.locator("tbody tr").first().locator("td").nth(1);
  await expect(firstAction).toHaveText("auth.login.succeeded");
});

test("sign out ends the session for real, not just in the browser", async ({ page }) => {
  await signInAsDemo(page);

  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"));

  // The proof is the redirect on the next attempt: the server no longer
  // recognises the session, cookie or no cookie.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("the header offers sign-in when signed out and the console when signed in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();

  await signInAsDemo(page);
  await page.goto("/");
  // Two matches are correct now: the sidebar destination and the header door.
  await expect(page.getByRole("link", { name: /admin console/i }).first()).toBeVisible();
});

test("the login page has no detectable WCAG A/AA violations in either language", async ({
  page,
}) => {
  for (const lang of ["en", "ja"]) {
    await page.goto(`/login?lang=${lang}`);

    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => `${lang} ${violation.id}: ${violation.help}`),
    ).toEqual([]);
  }
});

test("the operator console has no detectable WCAG A/AA violations", async ({ page }) => {
  await signInAsDemo(page);

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
  ).toEqual([]);
});

// Both of these come from a live charter run — a real person using the page
// for the first time, which is the only way either was going to be found.

test("one click fills both demo fields correctly", async ({ page }) => {
  await page.goto("/login");

  const email = page.getByLabel(/email address/i);
  const password = page.getByRole("textbox", { name: /^password$/i });

  await expect(email).toHaveValue("");

  await page.getByRole("button", { name: /fill these in for me/i }).click();

  // The failure this prevents: pasting the whole credentials block into the
  // email field, being told "Incorrect email or password", and concluding the
  // demo is broken.
  await expect(email).toHaveValue(DEMO_EMAIL);
  await expect(password).toHaveValue(DEMO_PASSWORD);
  await expect(page.getByText(/filled in — press sign in/i)).toBeVisible();

  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/admin");
  await expect(page.getByRole("heading", { name: /admin console/i, level: 1 })).toBeVisible();
});

test("the error clears as soon as you start correcting the field", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email address/i).fill("dmin@zerofayyz.test");
  await page.getByRole("textbox", { name: /^password$/i }).fill("whatever");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const error = page.getByText(/incorrect email or password/i);
  await expect(error).toBeVisible();

  // Typing a correction must not leave the old verdict on screen: a fixed
  // field that still reads "Incorrect" makes a correct fix look rejected.
  await page.getByLabel(/email address/i).fill("admin@zerofayyz.test");
  await expect(error).toHaveCount(0);
});

test("the password field has a working visibility toggle", async ({ page }) => {
  await page.goto("/login");

  const password = page.getByRole("textbox", { name: /^password$/i });
  await password.fill("something-secret");
  await expect(password).toHaveAttribute("type", "password");

  // The first attempt at this feature silently failed to land in the login
  // form — the component existed, the import existed, the field never changed.
  // Hence a test that clicks the actual button on the actual page.
  await page.getByRole("button", { name: /show password/i }).click();
  await expect(password).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: /hide password/i }).click();
  await expect(password).toHaveAttribute("type", "password");
});

test("a refusal offers a next step without confirming anything", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email address/i).fill("ghost@zerofayyz.test");
  await page.getByRole("textbox", { name: /^password$/i }).fill("wrong-password-123");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // The compromise: same refusal whether the account is wrong, missing, or
  // disabled — plus a line telling a confused legitimate person what to do,
  // which confirms nothing to a stranger probing for real accounts.
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  await expect(page.getByText(/contact your administrator/i)).toBeVisible();
});
