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
  await page.getByLabel(/password/i).fill(DEMO_PASSWORD);
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
  await page.getByLabel(/password/i).fill("not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  // getByRole("alert") alone is ambiguous here: Next.js injects its own
  // role="alert" route announcer into every page, so the locator must be
  // anchored to the message rather than the role.
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("the demo operator signs in, sees the audit log, and nothing above their role", async ({
  page,
}) => {
  await signInAsDemo(page);

  // What an operator gets: the history.
  await expect(page.getByRole("heading", { name: /audit log/i })).toBeVisible();
  await expect(page.getByText("auth.login.succeeded").first()).toBeVisible();

  // What an operator does not get. The API refuses these with 403 regardless;
  // this asserts the page is honest about it instead of showing broken panels.
  await expect(page.getByRole("heading", { name: /active sessions/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^accounts$/i })).toHaveCount(0);
  await expect(page.getByText(/signed in as an operator/i)).toBeVisible();
});

test("their own login is the newest entry in the audit log they see", async ({ page }) => {
  await signInAsDemo(page);

  const firstAction = page.locator("tbody tr").first().locator("td").nth(1);
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
  await expect(page.getByRole("link", { name: /admin console/i })).toBeVisible();
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
  const password = page.getByLabel(/password/i);

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
  await expect(page.getByRole("heading", { name: /admin console/i })).toBeVisible();
});

test("the error clears as soon as you start correcting the field", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email address/i).fill("dmin@zerofayyz.test");
  await page.getByLabel(/password/i).fill("whatever");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const error = page.getByText(/incorrect email or password/i);
  await expect(error).toBeVisible();

  // Typing a correction must not leave the old verdict on screen: a fixed
  // field that still reads "Incorrect" makes a correct fix look rejected.
  await page.getByLabel(/email address/i).fill("admin@zerofayyz.test");
  await expect(error).toHaveCount(0);
});
