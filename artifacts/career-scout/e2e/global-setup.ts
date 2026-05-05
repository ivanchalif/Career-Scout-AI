/**
 * Playwright global setup: authenticate with Clerk and persist the session.
 *
 * Requires:
 *   CLERK_E2E_EMAIL    - email address to sign in with
 *   CLERK_E2E_PASSWORD - password for that account
 *
 * Writes the session to e2e/.auth/user.json so tests can reuse it via
 * `test.use({ storageState: "e2e/.auth/user.json" })`.
 *
 * Run once before the test suite:
 *   pnpm exec playwright test --project=setup
 */
import { chromium, FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";

export default async function globalSetup(_config: FullConfig) {
  const authDir = path.join(process.cwd(), "e2e", ".auth");
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const email = process.env.CLERK_E2E_EMAIL;
  const password = process.env.CLERK_E2E_PASSWORD;

  if (!email || !password) {
    console.warn(
      "[global-setup] CLERK_E2E_EMAIL / CLERK_E2E_PASSWORD not set — " +
        "skipping auth setup. Tests that require auth will fail.",
    );
    fs.writeFileSync(
      path.join(authDir, "user.json"),
      JSON.stringify({ cookies: [], origins: [] }),
    );
    return;
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  const baseURL = devDomain
    ? `https://${devDomain}`
    : `http://localhost:${process.env.PORT ?? "3000"}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(baseURL);
  await page.waitForLoadState("networkidle");

  const emailInput = page.locator('input[name="identifier"]');
  if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await emailInput.fill(email);
    await page.locator('button[type="submit"]').click();

    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await passwordInput.fill(password);
      await page.locator('button[type="submit"]').click();
    }

    await page.waitForLoadState("networkidle");
  }

  await page.context().storageState({ path: path.join(authDir, "user.json") });
  await browser.close();
}
