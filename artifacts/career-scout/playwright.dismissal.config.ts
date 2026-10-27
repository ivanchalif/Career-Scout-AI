import { defineConfig, devices } from "@playwright/test";

// No saved Clerk session, database, AI calls, or live API server is used.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "dismissal.spec.ts",
  outputDir: "../../generated-artifacts/dismissal-tests",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5189",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "pnpm exec vite --config e2e/support/vite.config.ts",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
