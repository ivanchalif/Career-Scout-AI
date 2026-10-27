export type DashboardView = "active" | "applied" | "deleted";
export type DashboardSorts = Record<DashboardView, string>;

const validSorts = new Set([
  "recommended", "date-desc", "date-asc", "score-desc", "score-asc",
  "title-asc", "title-desc", "company-asc", "company-desc",
]);

export function readDashboardSorts(
  storage: Pick<Storage, "getItem">,
  userId: string,
): DashboardSorts {
  const defaults = { active: "recommended", applied: "recommended", deleted: "recommended" };
  try {
    const legacy = storage.getItem("dashboard-sort");
    const fallback = legacy && validSorts.has(legacy) ? legacy : "recommended";
    return Object.fromEntries(
      (["active", "applied", "deleted"] as const).map(view => {
        const saved = storage.getItem(`dashboard-sort:${userId}:${view}`);
        return [view, saved && validSorts.has(saved) ? saved : fallback];
      }),
    ) as DashboardSorts;
  } catch {
    return defaults;
  }
}

export function saveDashboardSort(
  storage: Pick<Storage, "setItem">,
  userId: string,
  view: DashboardView,
  value: string,
): void {
  try {
    storage.setItem(`dashboard-sort:${userId}:${view}`, value);
  } catch {
    // Sorting still works in memory when browser storage is unavailable.
  }
}
