/**
 * E2E: AI Scoring Pipeline
 *
 * Verifies the full AI scoring flow:
 *   1. Add a job posting via the dashboard add-job form
 *   2. Confirm the pending-ring indicator appears on the new posting card
 *   3. Navigate to the posting detail page (/postings/:id)
 *   4. Click "Analyze" / "Re-analyze" and confirm a numeric 0–100 score renders
 *
 * Auth: requires a valid Clerk session stored at e2e/.auth/user.json.
 *       Run `pnpm exec playwright test --project=setup` once to create it,
 *       then `pnpm test:e2e` for subsequent runs.
 */

import { test, expect } from "@playwright/test";

const UNIQUE_SUFFIX = Date.now();
const JOB_TITLE = `Senior TS Engineer ${UNIQUE_SUFFIX}`;
const JOB_COMPANY = `TestCo-${UNIQUE_SUFFIX}`;
const JOB_DESCRIPTION =
  "We are looking for a Senior TypeScript Engineer with 5+ years of experience. " +
  "Required skills: TypeScript, React, Node.js, GraphQL. " +
  "Salary: $140,000–$170,000/year. Remote OK.";

test.use({ storageState: "e2e/.auth/user.json" });

test("add posting → pending ring → re-analyze → score appears", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-page")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("add-job-button").click();

  await expect(page.getByTestId("input-job-title")).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("input-job-title").fill(JOB_TITLE);
  await page.getByTestId("input-company").fill(JOB_COMPANY);
  await page.getByTestId("input-job-description").fill(JOB_DESCRIPTION);

  const linkInput = page.getByTestId("input-job-link");
  if (await linkInput.isVisible()) {
    await linkInput.fill("https://example.com/job/senior-ts");
  }

  await page.getByTestId("submit-add-job").click();

  const postingCard = page.locator(`[data-testid^="posting-card-"]`).filter({
    has: page.locator(`[data-testid^="posting-title-"]`, { hasText: JOB_TITLE }),
  });
  await expect(postingCard).toBeVisible({ timeout: 15_000 });

  const pendingRing = postingCard.getByTestId("score-ring-pending");
  await expect(pendingRing).toBeVisible({ timeout: 10_000 });

  const cardTestId = await postingCard.getAttribute("data-testid");
  const postingId = cardTestId?.replace("posting-card-", "");
  expect(postingId).toBeTruthy();

  await page.goto(`/postings/${postingId}`);
  await expect(page.getByTestId("posting-detail-page")).toBeVisible({ timeout: 10_000 });

  const analyzeButton = page.getByTestId("analyze-button");
  await expect(analyzeButton).toBeVisible({ timeout: 5_000 });
  await analyzeButton.click();

  const scoreRing = page.getByTestId("score-ring");
  await expect(scoreRing).toBeVisible({ timeout: 45_000 });

  const scoreText = await scoreRing.textContent();
  const score = parseInt(scoreText?.trim() ?? "", 10);
  expect(Number.isInteger(score)).toBe(true);
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);
});
