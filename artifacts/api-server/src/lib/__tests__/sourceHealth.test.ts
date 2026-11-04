import { describe, expect, it } from "vitest";
import { buildSourceHealth } from "../sourceHealth";
import type { DiscoveryProgress } from "@workspace/db";

const now = new Date("2026-11-04T12:00:00Z");
const source = { id: 1, provider: "brave-linkedin", isSuppressed: false };
const other = { id: 2, provider: "brave-jobright", isSuppressed: false };
type Posting = Parameters<typeof buildSourceHealth>[2][number];
function job(id: number, patch: Partial<Posting> = {}): Posting {
  return {
    id, source: "brave:1", title: "Product Manager", company: "Example",
    link: `https://example.com/job/${id}`, location: "San Francisco, CA", remoteType: "hybrid",
    sourcePostedAt: null, createdAt: new Date("2026-11-02T12:00:00Z"),
    appliedAt: null, deletedAt: null, deletedBy: null, ...patch,
  };
}
const health = (jobs: Posting[], runs?: DiscoveryProgress["sourceRuns"]) =>
  buildSourceHealth(source, [source, other], jobs, [], [], null, runs, now);

describe("source health from actual eligible additions", () => {
  it("uses yellow for no evidence and does not invent historical per-run counts", () => {
    expect(health([])).toMatchObject({ color: "yellow", label: "Learning", totalAdded: 0, latestSearchAdded: null });
    expect(health([job(1)])).toMatchObject({ color: "yellow", totalAdded: 1, knownPostingDates: 0 });
  });
  it("credits only the primary importer and ignores duplicate sightings", () => {
    const stats = buildSourceHealth(source, [source, other], [
      job(1), job(2, { source: "gmail" }), job(3, { source: "online" }),
    ], [
      { jobPostingId: 1, provider: "brave:2", isPrimary: false },
      { jobPostingId: 2, provider: "brave:1", isPrimary: false },
      { jobPostingId: 3, provider: "brave:2", isPrimary: true },
    ], [], null, undefined, now);
    expect(stats.totalAdded).toBe(1);
  });
  it("excludes Workday, non-local non-remote, company and title filtered postings from counts", () => {
    const stats = buildSourceHealth(source, [source], [
      job(1), job(2, { link: "https://example.myworkdayjobs.com/jobs/123" }),
      job(3, { location: "Broomfield, CO", remoteType: null }),
      job(4, { title: "Intern Product Manager" }), job(5, { company: "Blocked" }),
    ], [], [], {
      titleExcludeKeywords: ["Intern"], companyFilterSettings: { mode: "exclude", companies: ["Blocked"] },
    }, { "1": [{ at: now.toISOString(), addedPostingIds: [1, 2, 3, 4, 5], error: null }] }, now);
    expect(stats).toMatchObject({ totalAdded: 1, latestSearchAdded: 1 });
  });
  it("uses authentic posting dates, not import time, to judge recency", () => {
    const fresh = [job(1), job(2), job(3)].map(j => ({ ...j, sourcePostedAt: new Date("2026-11-01") }));
    expect(health(fresh)).toMatchObject({ color: "green", recentPostings: 3, knownPostingDates: 3 });
    expect(health(fresh.map(j => ({ ...j, sourcePostedAt: null })))).toMatchObject({ color: "yellow", knownPostingDates: 0 });
    expect(health(fresh.map(j => ({ ...j, sourcePostedAt: new Date("2020-01-01") })))).toMatchObject({ color: "yellow", recentPostings: 0 });
  });
  it("reacts to apply, dismissal, Undo and unapply without treating system cleanup as user feedback", () => {
    expect(health([job(1, { appliedAt: now })])).toMatchObject({ color: "green", applied: 1 });
    expect(health([job(1)])).toMatchObject({ color: "yellow", applied: 0 });
    const dismissed = [1, 2, 3].map(id => job(id, { deletedAt: now, deletedBy: "user" }));
    expect(health(dismissed)).toMatchObject({ color: "red", dismissed: 3, totalAdded: 3 });
    expect(health(dismissed.map(j => ({ ...j, deletedAt: null, deletedBy: null })))).toMatchObject({ color: "yellow", dismissed: 0 });
    expect(health(dismissed.map(j => ({ ...j, deletedBy: "auto" })))).toMatchObject({ color: "yellow", dismissed: 0 });
  });
  it("keeps a paused source yellow and preserves its historical counts", () => {
    const stats = buildSourceHealth({ ...source, isSuppressed: true }, [source], [job(1)], [], [], null,
      { "1": [{ at: now.toISOString(), addedPostingIds: [1], error: "403" }] }, now);
    expect(stats).toMatchObject({ color: "yellow", label: "Paused", totalAdded: 1, latestSearchAdded: 1 });
  });
  it("distinguishes search failures from insufficient yield history", () => {
    expect(health([], { "1": [{ at: now.toISOString(), addedPostingIds: [], error: "Source request failed" }] }))
      .toMatchObject({ color: "red", label: "Needs attention", latestSearchAdded: 0 });
    expect(health([], { "1": [{ at: now.toISOString(), addedPostingIds: [], error: null }] }))
      .toMatchObject({ color: "yellow" });
    expect(health([], { "1": ["2026-10-01", "2026-10-10", "2026-11-04"].map(at => ({ at, addedPostingIds: [], error: null })) }))
      .toMatchObject({ color: "red", label: "Low yield" });
  });
});
