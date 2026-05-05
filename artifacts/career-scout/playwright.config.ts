import { defineConfig, devices } from "@playwright/test";

const devDomain = process.env.REPLIT_DEV_DOMAIN;
const baseURL = devDomain
  ? `https://${devDomain}`
  : `http://localhost:${process.env.PORT ?? "3000"}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
