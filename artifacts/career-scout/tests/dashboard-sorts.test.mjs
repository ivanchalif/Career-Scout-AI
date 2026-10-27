import { test } from "node:test";
import assert from "node:assert/strict";
import { readDashboardSorts, saveDashboardSort } from "../src/lib/dashboard-sorts.ts";

function memoryStorage(initial = []) {
  const data = new Map(initial);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("each view retains its own sorting after reload", () => {
  const storage = memoryStorage();
  saveDashboardSort(storage, "a", "active", "score-desc");
  saveDashboardSort(storage, "a", "applied", "company-asc");
  saveDashboardSort(storage, "a", "deleted", "date-desc");
  assert.deepEqual(readDashboardSorts(storage, "a"), {
    active: "score-desc", applied: "company-asc", deleted: "date-desc",
  });
  saveDashboardSort(storage, "a", "applied", "title-asc");
  assert.equal(readDashboardSorts(storage, "a").active, "score-desc");
  assert.equal(readDashboardSorts(storage, "a").deleted, "date-desc");
});

test("sort settings are isolated between users", () => {
  const storage = memoryStorage();
  saveDashboardSort(storage, "a", "active", "title-asc");
  assert.equal(readDashboardSorts(storage, "b").active, "recommended");
});

test("previous shared sort is retained until each view is customized", () => {
  const storage = memoryStorage([["dashboard-sort", "date-asc"]]);
  saveDashboardSort(storage, "a", "applied", "company-desc");
  assert.deepEqual(readDashboardSorts(storage, "a"), {
    active: "date-asc", applied: "company-desc", deleted: "date-asc",
  });
});

test("invalid values and unavailable storage safely use defaults", () => {
  const storage = memoryStorage([["dashboard-sort", "invalid"], ["dashboard-sort:a:active", "invalid"]]);
  assert.equal(readDashboardSorts(storage, "a").active, "recommended");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readDashboardSorts(blocked, "a").active, "recommended");
  assert.doesNotThrow(() => saveDashboardSort(blocked, "a", "active", "date-desc"));
});
