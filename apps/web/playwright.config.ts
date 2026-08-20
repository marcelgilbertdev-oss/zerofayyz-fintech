import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3000;
const API_PORT = 4000;

/**
 * Starts the API and the dashboard together, because the reviewer's path
 * crosses both: the page renders server-side from live API responses, so an
 * end-to-end test that stubs the API would prove nothing.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
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
