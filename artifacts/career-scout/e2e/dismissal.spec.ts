import { test, expect } from "./support/dismissal-fixture";

test("distinct-job comparison persists after reload without dismissing the job", async ({ page, dismissal }) => {
  dismissal.duplicatePair = {
    id1: dismissal.id, id2: dismissal.id + 1,
    title1: dismissal.item.posting.title, title2: "Same-employer review candidate",
    company1: dismissal.item.posting.company, company2: dismissal.item.posting.company,
    applied_at2: "2026-01-01T00:00:00.000Z", confidence: "review",
    evidence: ["Same employer", "Matching specialty"],
  };
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByTestId(`duplicate-evidence-${dismissal.id}`)).toContainText("Matching specialty");
  await page.getByRole("button", { name: "Not a dup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Not a dup", exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toBeVisible();
  expect(dismissal.pairSaved).toBe(true);
  expect(dismissal.mutations).toEqual([]);
  await page.reload();
  await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Not a dup", exact: true })).toHaveCount(0);
});

test("distinct-job comparison save failure preserves the suggestion and allows retry", async ({ page, dismissal }) => {
  dismissal.duplicatePair = {
    id1: dismissal.id, id2: dismissal.id + 1,
    title1: dismissal.item.posting.title, title2: "Review candidate",
    company1: dismissal.item.posting.company, company2: dismissal.item.posting.company,
    applied_at2: "2026-01-01T00:00:00.000Z", confidence: "review", evidence: ["Same employer"],
  };
  dismissal.failPairSave = true;
  await page.goto("/dashboard");
  const button = page.getByRole("button", { name: "Not a dup", exact: true });
  await button.click();
  await expect(page.getByText("Could not save comparison", { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
  expect(dismissal.pairSaved).toBe(false);
  await button.click();
  await expect(button).toHaveCount(0);
  expect(dismissal.pairSaved).toBe(true);
});
// Independent contract: deriving this from the renderer's array would allow a
// deleted option or incorrect label to silently shrink the coverage.
const expectedReasons = [
  { kind: "duplicate", label: "Flag as duplicate" },
  { kind: "already_closed", label: "Mark as closed" },
  { kind: "not_my_role", label: "Not my role" },
  { kind: "too_junior", label: "Too junior" },
  { kind: "workday", label: "Workday" },
  { kind: "wrong_domain", label: "Wrong domain" },
  { kind: "wrong_location", label: "Wrong location" },
] as const;

test("dialog and open reason menu survive card removal and 60 seconds without interaction", async ({ page, dismissal }) => {
  await page.clock.install();
  await page.goto("/dashboard");
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  const dialog = page.getByRole("dialog", { name: "Job dismissed" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add reason" }).click();
  await page.clock.fastForward(60_000);
  // Radix's modal menu temporarily hides its parent dialog from the
  // accessibility tree; assert the actual dialog element remains visible.
  await expect(page.getByTestId(`dismiss-dialog-${dismissal.id}`)).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveText(expectedReasons.map(reason => reason.label));
  await page.getByRole("menuitem", { name: "Wrong location", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Reason: Wrong location");
  await dialog.getByRole("button", { name: "Undo dismissal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toBeVisible();
});

for (const { kind, label } of expectedReasons) {
  test(`saves shared reason ${kind} and shows it in Deleted after reload`, async ({ page, dismissal }) => {
    await page.goto("/dashboard");
    await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
    const dialog = page.getByRole("dialog", { name: "Job dismissed" });
    await dialog.getByRole("button", { name: "Add reason" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(expectedReasons.map(reason => reason.label));
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText(`Reason: ${label}`);
    expect(dismissal.mutations).toEqual([
      { action: "dismiss", body: { reason: null } },
      { action: "dismissal-reason", body: { reason: kind, undoToken: dismissal.item.posting.dismissalUndoToken } },
    ]);
    expect(dismissal.item.feedback?.kind).toBe(kind);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.getByTestId("tab-deleted").click();
    await expect(page.getByTestId(`deleted-reason-${dismissal.id}`)).toHaveText(`Reason: ${label}`);
    await expect(page.getByTestId(`deleted-posting-card-${dismissal.id}`)).toBeVisible();
  });
}

test("changing reasons twice then Undo restores the exact pre-dismissal feedback using the latest token", async ({ page, dismissal }) => {
  dismissal.item.feedback = structuredClone(dismissal.originalFeedback);
  // Current API retains the token; rotating here guards the client's contract
  // that the newest response token, not the original prop, must be used.
  dismissal.rotateReasonToken = true;
  await page.goto("/dashboard");
  await expect(page.getByTestId(`posting-flag-duplicate-${dismissal.id}`)).toBeVisible();
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  const dialog = page.getByRole("dialog", { name: "Job dismissed" });
  const firstToken = dismissal.item.posting.dismissalUndoToken;
  await dialog.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("menuitem", { name: "Not my role", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Reason: Not my role");
  const secondToken = dismissal.item.posting.dismissalUndoToken;
  expect(secondToken).not.toBe(firstToken);
  await dialog.getByRole("button", { name: "Change reason" }).click();
  await page.getByRole("menuitem", { name: "Workday", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Reason: Workday");
  const latestToken = dismissal.item.posting.dismissalUndoToken;
  expect(latestToken).not.toBe(secondToken);
  await dialog.getByRole("button", { name: "Undo dismissal" }).click();
  await expect(dialog).toHaveCount(0);
  expect(dismissal.mutations.slice(1)).toEqual([
    { action: "dismissal-reason", body: { undoToken: firstToken, reason: "not_my_role" } },
    { action: "dismissal-reason", body: { undoToken: secondToken, reason: "workday" } },
    { action: "undo-dismissal", body: { undoToken: latestToken } },
  ]);
  expect(dismissal.item.feedback).toEqual(dismissal.originalFeedback);
  expect(dismissal.item.posting.deletedAt).toBeNull();
  await expect(page.getByTestId(`posting-flag-duplicate-${dismissal.id}`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`posting-flag-duplicate-${dismissal.id}`)).toBeVisible();
});

for (const priorFeedback of [false, true]) {
  test(`Not now adds no feedback (${priorFeedback ? "preserves prior feedback" : "starts without feedback"})`, async ({ page, dismissal }) => {
    dismissal.item.feedback = priorFeedback ? structuredClone(dismissal.originalFeedback) : null;
    const prior = structuredClone(dismissal.item.feedback);
    await page.goto("/dashboard");
    await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
    const dialog = page.getByRole("dialog", { name: "Job dismissed" });
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toHaveCount(0);
    expect(dismissal.mutations).toEqual([{ action: "dismiss", body: { reason: null } }]);
    expect(dismissal.item.feedback).toEqual(prior);
    expect(dismissal.item.posting.deletedAt).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toHaveCount(0);
    await page.getByTestId("tab-deleted").click();
    await expect(page.getByTestId(`deleted-posting-card-${dismissal.id}`)).toBeVisible();
    // Undo is still available from Deleted after opting out of the prompt.
    await page.getByTestId(`posting-undo-dismissal-${dismissal.id}`).click();
    await page.getByTestId("tab-active").click();
    await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toBeVisible();
    expect(dismissal.item.feedback).toEqual(prior);
  });
}

test("detail dismissal survives the real redirect, saves a reason, then Undo restores the dashboard card", async ({ page, dismissal }) => {
  await page.goto(`/postings/${dismissal.id}`);
  await expect(page.getByTestId("posting-detail-page")).toBeVisible();
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByTestId("posting-detail-page")).toHaveCount(0);
  const dialog = page.getByRole("dialog", { name: "Job dismissed" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("menuitem", { name: "Flag as duplicate", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Reason: Flag as duplicate");
  await dialog.getByRole("button", { name: "Undo dismissal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toBeVisible();
  expect(dismissal.item.feedback).toBeNull();
});

test("failed save and Undo keep controls usable, preserve feedback, and allow retries", async ({ page, dismissal }) => {
  dismissal.item.feedback = structuredClone(dismissal.originalFeedback);
  await page.goto("/dashboard");
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  const dialog = page.getByRole("dialog", { name: "Job dismissed" });
  dismissal.failNext("dismissal-reason");
  dismissal.holdNext("dismissal-reason");
  await dialog.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("menuitem", { name: "Wrong location", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Undo dismissal" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  dismissal.release();
  await expect(dialog.getByRole("alert")).toHaveText("Could not save reason. Your job is still dismissed. Try again or choose Not now.");
  await expect(dialog.getByRole("button", { name: "Add reason" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Undo dismissal" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeEnabled();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(dismissal.item.feedback).toEqual(dismissal.originalFeedback);
  await dialog.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("menuitem", { name: "Workday", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Reason: Workday");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  dismissal.failNext("undo-dismissal");
  dismissal.holdNext("undo-dismissal");
  await dialog.getByRole("button", { name: "Undo dismissal" }).click();
  await expect(dialog.getByRole("button", { name: "Restoring…" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Change reason" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
  dismissal.release();
  await expect(dialog.getByRole("alert")).toHaveText("Could not undo. Please try again.");
  await expect(dialog.getByRole("button", { name: "Undo dismissal" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Change reason" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("status")).toHaveText("Reason: Workday");
  expect(dismissal.item.posting.deletedAt).not.toBeNull();
  expect(dismissal.item.feedback?.kind).toBe("workday");
  await dialog.getByRole("button", { name: "Undo dismissal" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`posting-card-${dismissal.id}`)).toBeVisible();
  expect(dismissal.item.feedback).toEqual(dismissal.originalFeedback);
});

test("Not now remains a working exit after a failed save", async ({ page, dismissal }) => {
  await page.goto("/dashboard");
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  const dialog = page.getByRole("dialog", { name: "Job dismissed" });
  dismissal.failNext("dismissal-reason", 409);
  await dialog.getByRole("button", { name: "Add reason" }).click();
  await page.getByRole("menuitem", { name: "Mark as closed", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toHaveCount(0);
  expect(dismissal.item.feedback).toBeNull();
  expect(dismissal.item.posting.deletedAt).not.toBeNull();
});

test("failed initial dismissal on detail does not redirect or remove the Dismiss control", async ({ page, dismissal }) => {
  await page.goto(`/postings/${dismissal.id}`);
  dismissal.failNext("dismiss");
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  await expect(page.getByText("Could not dismiss job", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`/postings/${dismissal.id}`);
  await expect(page.getByRole("dialog", { name: "Job dismissed" })).toHaveCount(0);
  await expect(page.getByTestId(`posting-dismiss-${dismissal.id}`)).toBeEnabled();
  expect(dismissal.item.posting.deletedAt).toBeNull();
  await page.getByTestId(`posting-dismiss-${dismissal.id}`).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("dialog", { name: "Job dismissed" })).toBeVisible();
});
