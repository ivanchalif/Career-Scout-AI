import { describe, expect, it } from "vitest";
import { analyzeSource, type InvestigationProbe } from "../sourceInvestigationAnalysis";

const now = new Date("2026-11-06T12:00:00Z");
const source = {
  id: 1, provider: "brave", name: "Example jobs", kind: "search", isSuppressed: false,
  url: "https://www.google.com/search?q=site%3Aexample.com%2Fjobs+product+-sales",
  updatedAt: now,
};
const job = (id: number, patch = {}) => ({
  id, source: "brave:1", title: "Junior Product Manager", company: "Example", link: `https://example.com/jobs/${id}`,
  location: "San Francisco", remoteType: null, sourcePostedAt: null, createdAt: now,
  appliedAt: null, deletedAt: now, deletedBy: "user", ...patch,
});
const probe: InvestigationProbe = {
  status: "ok", error: null, retrieved: 5, unseen: 2, eligibleBySavedFilters: 1,
  knownPostingDates: 0, recoveryNotes: [], warnings: [],
};

describe("source investigation recommendations", () => {
  it("explains low usefulness using attributed feedback and previews a source-local query change", () => {
    const result = analyzeSource(source, [source], [job(1), job(2), job(3)], [],
      [1, 2, 3].map(jobPostingId => ({ jobPostingId, kind: "too_junior" })), null, undefined, probe, now);
    expect(result.health.label).toBe("Low usefulness");
    expect(result.dismissals).toEqual([{ reason: "too_junior", count: 3 }]);
    const fix = result.recommendations.find(item => item.action === "update_query")!;
    expect(new URL(fix.proposedUrl!).searchParams.get("q")).toBe("site:example.com/jobs product -sales -junior -intern");
    expect(result.recommendations.some(item => item.action === "pause")).toBe(true);
    expect(result.findings.some(item => item.includes("not promised additions"))).toBe(true);
    expect(result.findings.some(item => item.includes("dates are unknown"))).toBe(true);
  });
  it("does not invent query exclusions from wrong domain or location feedback", () => {
    const result = analyzeSource(source, [source], [job(1), job(2), job(3)], [],
      [1, 2, 3].map(jobPostingId => ({ jobPostingId, kind: "wrong_domain" })), null, undefined, probe, now);
    expect(result.recommendations.some(item => item.action === "update_query")).toBe(false);
    expect(result.recommendations.some(item => item.action === "edit")).toBe(true);
  });
  it("excludes filtered jobs and secondary duplicate sightings from feedback evidence", () => {
    const result = analyzeSource(source, [source], [
      job(1), job(2, { source: "gmail" }), job(3, { title: "Excluded role" }),
    ], [{ jobPostingId: 2, provider: "brave:1", isPrimary: false }],
    [1, 2, 3].map(jobPostingId => ({ jobPostingId, kind: "too_junior" })),
    { titleExcludeKeywords: ["Excluded"] }, undefined, probe, now);
    expect(result.dismissals).toEqual([{ reason: "too_junior", count: 1 }]);
    expect(result.recommendations.some(item => item.action === "update_query")).toBe(false);
  });
  it("does not propose built-in URL edits or re-pause a paused source", () => {
    const result = analyzeSource({ ...source, kind: "builtin", isSuppressed: true }, [source], [job(1), job(2)], [],
      [1, 2].map(jobPostingId => ({ jobPostingId, kind: "too_junior" })), null, undefined,
      { ...probe, status: "failed", error: "HTTP 429" }, now);
    expect(result.recommendations.map(item => item.action)).toEqual(["retry"]);
    expect(result.findings.some(item => item.includes("HTTP 429"))).toBe(true);
  });
  it("treats saved-only results as repeated coverage, not a reason to relax duplicate protection", () => {
    const result = analyzeSource(source, [source], [], [], [], null, undefined, { ...probe, unseen: 0 }, now);
    expect(result.findings.some(item => item.includes("duplicate protection should remain enabled"))).toBe(true);
  });
});
