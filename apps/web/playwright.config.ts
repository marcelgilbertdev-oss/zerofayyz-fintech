import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3000;
const API_PORT = 4000;

/**
 * Point the runner at a stack that is already up, instead of starting one.
 *
 * Needed because visual-regression baselines are per-platform: a snapshot
 * recorded on macOS does not match one rendered on Linux, so the Linux
 * baselines CI compares against have to be produced inside the same container
 * image CI uses. That container cannot build this app (different native
 * binaries), but it can drive a server running on the host.
 */
const EXTERNAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL;

/**
 * Starts the API and the dashboard together, because the reviewer's path
 * crosses both: the page renders server-side from live API responses, so an
 * end-to-end test that stubs the API would prove nothing.
 */
export default defineConfig({
  testDir: "./e2e",
  /**
   * Visual regression is opt-in, because screenshot baselines are specific to
   * the renderer that produced them — fonts and rasterisation differ between a
   * plain Ubuntu runner and the Playwright container image. The baselines in
   * this repository were recorded on macOS and inside
   * mcr.microsoft.com/playwright:v1.62.1-noble, so the suite runs there and
   * nowhere else. Running it on a mismatched renderer produces failures that
   * mean nothing, which is how teams learn to ignore a visual suite.
   */
  testIgnore: process.env.PLAYWRIGHT_VISUAL ? [] : ["**/visual-regression.spec.ts"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: EXTERNAL_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // When a base URL is supplied the stack is someone else's problem — see the
  // note above. globalSetup seeds the database, which the external stack
  // already has, so it is skipped too.
  globalSetup: EXTERNAL_BASE_URL ? undefined : "./e2e/global-setup.ts",
  webServer: EXTERNAL_BASE_URL ? undefined : [
    {
      // Compiled output in both servers, so the pipeline exercises what ships.
      command: "npm run build && npm start",
      cwd: "../api",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Built output, not `next dev`. The dev server blocks its own asset
      // requests when the origin differs from the one it was started on
      // (127.0.0.1 vs localhost), which leaves React unhydrated and every
      // button inert. Testing the production build also tests what deploys.
      command: "npm run build && npm run start",
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
