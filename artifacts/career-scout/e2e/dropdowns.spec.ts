import { test, expect } from "./support/dismissal-fixture";

test("onboarding preference reflects loaded data and survives rerender and reload", async ({ page, dismissal }) => {
  await page.goto("/onboarding");
  const trigger = page.getByTestId("remote-select");
  await expect(trigger).toHaveText("Remote");
  for (const choice of ["On-site", "Hybrid", "Remote"]) {
    await trigger.click();
    await expect(page.getByRole("option")).toHaveCount(3);
    await page.getByRole("option", { name: choice, exact: true }).click();
    await expect(trigger).toHaveText(choice);
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(trigger).toHaveText(dismissal.profile.remotePreference === "remote" ? "Remote" : "Hybrid");
  expect(dismissal.profileSaves).toEqual([]);
});

test("Gmail schedule saves every choice including manual and recovers after failure", async ({ page, dismissal }) => {
  dismissal.gmailConnected = true;
  await page.goto("/inbox");
  const trigger = page.getByTestId("sync-schedule-trigger");
  await expect(trigger).toHaveText("Every 6 hours");
  for (const [label, hours] of [
    ["Every 30 minutes", 0.5], ["Every 1 hour", 1], ["Every 12 hours", 12],
    ["Every 24 hours", 24], ["Every 6 hours", 6], ["Manual only", null],
  ] as const) {
    await trigger.click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveText(label);
    expect(dismissal.profileSaves.at(-1)).toEqual({ syncScheduleHours: hours });
  }
  await page.reload();
  await expect(trigger).toHaveText("Manual only");
  dismissal.failProfileSave = true;
  await trigger.click();
  await page.getByRole("option", { name: "Every 6 hours", exact: true }).click();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText("Manual only");
  await trigger.click();
  await page.getByRole("option", { name: "Every 1 hour", exact: true }).click();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText("Every 1 hour");
});

test("all three filtered-page selectors can select every option and reopen", async ({ page, dismissal }) => {
  expect(dismissal.account.id).toBeTruthy();
  await page.goto("/filtered");
  for (const tab of ["Suppressed", "Skipped during sync", "Sync log"]) {
    await page.getByRole("button", { name: new RegExp(tab, "i") }).click();
    const trigger = page.getByRole("combobox");
    await trigger.click();
    const labels = await page.getByRole("option").allTextContents();
    expect(labels.length).toBeGreaterThan(5);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    for (const label of labels) {
      await trigger.click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await expect(trigger).toHaveText(label);
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
  }
});

test("dashboard discovery native selectors save each option without reloading", async ({ page, dismissal }) => {
  await page.goto("/dashboard");
  await page.getByTestId("toggle-online-discovery-panel").click();
  const schedule = page.getByTestId("discovery-schedule-select");
  for (const value of ["12", "24", "72", "manual"]) {
    await schedule.selectOption(value);
    await expect(schedule).toBeEnabled();
    await expect(schedule).toHaveValue(value);
    expect(dismissal.discoverySaves.at(-1)?.scheduleHours).toBe(value === "manual" ? null : Number(value));
  }
  const freshness = page.getByTestId("discovery-freshness-select");
  for (const value of ["past_month", "any_time", "past_week"]) {
    await freshness.selectOption(value);
    await expect(freshness).toBeEnabled();
    await expect(freshness).toHaveValue(value);
    expect(dismissal.discoverySaves.at(-1)?.freshnessWindow).toBe(value);
  }
});

for (const width of [1280, 390]) {
  test(`job action submenu works by keyboard at ${width}px and leaves the page usable`, async ({ page, dismissal }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/dashboard");
    const trigger = page.getByTestId(`posting-more-actions-${dismissal.id}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await trigger.focus();
      await page.keyboard.press("Enter");
      const submenu = page.getByTestId(`posting-dismiss-with-reason-${dismissal.id}`);
      await expect(submenu).toBeVisible();
      await submenu.focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("menuitem", { name: "Workday", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
    await trigger.click();
    await page.getByTestId(`posting-dismiss-with-reason-${dismissal.id}`).hover();
    await page.getByRole("menuitem", { name: "Flag as duplicate", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(dismissal.mutations[0]).toEqual({ action: "dismiss", body: { reason: "duplicate" } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => page.locator("body").evaluate(el => getComputedStyle(el).pointerEvents)).not.toBe("none");
    await page.getByTestId("dashboard-tools-button").click();
    await expect(page.getByTestId("dedup-sweep-button")).toBeVisible();
  });
}
