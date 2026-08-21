import { expect, test, type Page } from "@playwright/test";

/**
 * The refund workflow and account management, as one serial story.
 *
 * Serial on purpose: the tests share one database and the schema enforces one
 * pending refund request per payment, so parallel workers would collide on
 * exactly the constraint the feature exists to enforce. The flow also
 * self-heals — every request it raises is decided before the run ends, so a
 * crashed previous run cannot poison the next one.
 */
test.describe.configure({ mode: "serial" });

const DEMO_EMAIL = "demo@zerofayyz.test";
const DEMO_PASSWORD = "view-the-ledger";
const ADMIN_EMAIL = "admin@zerofayyz.test";
// The pipeline seeds this value in CI; locally, run seed:staff with the same
// one before the suite. Production is seeded by a person with a real password.
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "ci-throwaway-admin-password";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email address/i).first().fill(email);
  await page.getByLabel(/^password$/i).first().fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/admin");
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /sign out$/i }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/admin"));
}

/** Clears the queue as the signed-in user: rejects what others raised,
 * withdraws what they raised themselves. Leaves the suite immune to state a
 * crashed earlier run left behind. */
async function clearPending(page: Page) {
  for (let i = 0; i < 8; i += 1) {
    const withdraw = page.getByRole("button", { name: /^withdraw$/i }).first();

    if ((await withdraw.count()) > 0) {
      await withdraw.click();
      await page.waitForURL("**/admin");
      continue;
    }

    const reject = page.getByRole("button", { name: /^reject$/i }).first();

    if ((await reject.count()) === 0) {
      return;
    }

    await reject.click();
    await page.getByPlaceholder(/why not/i).fill("Cleared by the e2e suite");
    await page.getByRole("button", { name: /^reject$/i }).click();
    await page.waitForURL("**/admin");
  }
}

test("an operator raises a refund request; the admin sees it and rejects it with a note", async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await clearPending(page);
  await signOut(page);

  await signIn(page, DEMO_EMAIL, DEMO_PASSWORD);
  await expect(page.getByRole("heading", { name: /refund queue/i })).toBeVisible();

  await page.getByRole("button", { name: /request refund/i }).first().click();
  const reason = `Reviewer requested refund ${Date.now()}`;
  await page.getByPlaceholder(/why is this being refunded/i).fill(reason);
  await page.getByRole("button", { name: /submit request/i }).click();
  await page.waitForURL("**/admin");

  await expect(page.getByText(reason)).toBeVisible();
  // Operators see the queue and no decision buttons — deciding is not theirs.
  await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);

  await signOut(page);
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByText(reason)).toBeVisible();

  await page.getByRole("button", { name: /^reject$/i }).first().click();
  await page.getByPlaceholder(/why not/i).fill("Sandbox decision for the e2e suite");
  await page.getByRole("button", { name: /^reject$/i }).click();
  await page.waitForURL("**/admin");

  await expect(page.getByText(/Sandbox decision for the e2e suite/).first()).toBeVisible();

  // And the whole exchange is in the history.
  await expect(page.getByText("refund.requested").first()).toBeVisible();
  await expect(page.getByText("refund.rejected").first()).toBeVisible();
});

test("the four-eyes rule is visible: an admin cannot decide their own request", async ({
  page,
}) => {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.getByRole("button", { name: /request refund/i }).first().click();
  const reason = `Admin-raised request ${Date.now()}`;
  await page.getByPlaceholder(/why is this being refunded/i).fill(reason);
  await page.getByRole("button", { name: /submit request/i }).click();
  await page.waitForURL("**/admin");

  const ownRow = page.locator("tr", { hasText: reason });
  await expect(ownRow).toBeVisible();
  await expect(ownRow.getByText(/someone else must decide/i)).toBeVisible();
  await expect(ownRow.getByRole("button", { name: /^approve$/i })).toHaveCount(0);

  // What the requester CAN do with their own request is take it back.
  await ownRow.getByRole("button", { name: /^withdraw$/i }).click();
  await page.waitForURL("**/admin");
  await expect(page.locator("tr", { hasText: reason }).getByText(/^withdrawn$/i)).toBeVisible();
  await expect(page.getByText("refund.withdrawn").first()).toBeVisible();
});

test("a second admin decides what the first could not, and accounts can be disabled", async ({
  page,
}) => {
  const email = `e2e-second-admin-${Date.now()}@zerofayyz.test`;
  const password = "a-throwaway-e2e-password";

  // The first admin creates a second admin through the console.
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Scoped to the create form: every account row also carries a Role control,
  // so unscoped label queries match a dozen elements.
  const form = page.locator("form", { hasText: /create a staff account/i });
  await form.getByLabel(/^email address$/i).fill(email);
  await form.getByLabel(/display name/i).fill("E2E Second Admin");
  await form.getByLabel(/^role$/i).selectOption("admin");
  await form.getByLabel(/password \(min/i).fill(password);
  await form.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/admin");
  await expect(page.locator("tr", { hasText: email })).toBeVisible();

  // Still signed in as the first admin: raise the request the second admin
  // will decide.
  await page.getByRole("button", { name: /request refund/i }).first().click();
  const crossReason = `Cross-admin decision ${Date.now()}`;
  await page.getByPlaceholder(/why is this being refunded/i).fill(crossReason);
  await page.getByRole("button", { name: /submit request/i }).click();
  await page.waitForURL("**/admin");
  await signOut(page);

  // The second admin decides what the first could not — four eyes, two people.
  await signIn(page, email, password);
  const crossRow = page.locator("tr", { hasText: crossReason });
  await expect(crossRow.getByRole("button", { name: /^approve$/i })).toBeVisible();
  await crossRow.getByRole("button", { name: /^reject$/i }).click();
  await page.getByPlaceholder(/why not/i).fill("Decided by the second admin");
  await page.getByRole("button", { name: /^reject$/i }).click();
  await page.waitForURL("**/admin");
  await expect(page.getByText(/Decided by the second admin/).first()).toBeVisible();
  await signOut(page);

  // The first admin disables the second; the account's login dies with the
  // same message a wrong password gets — being disabled is not something an
  // account announces to the internet.
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const row = page.locator("tr", { hasText: email });
  await row.getByRole("button", { name: /^disable$/i }).click();
  await page.waitForURL("**/admin");
  await expect(page.locator("tr", { hasText: email }).getByText(/^disabled$/i)).toBeVisible();
  await signOut(page);

  await page.goto("/login");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
});
