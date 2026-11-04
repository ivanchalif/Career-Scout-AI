import { describe, it, expect, vi } from "vitest";
import { searchBeyondKnown, pruneRejected, buildBroaderSearchQuery } from "../discoverySearch";
import type { OnlineJobCandidate } from "../sources/arbeitnow";

function job(id: string): OnlineJobCandidate {
  return {
    provider: "brave:test", sourceJobId: id, title: "Product Manager",
    company: "Example", description: "Roadmapping", url: `https://example.com/jobs/${id}`,
    location: null, remote: false, tags: [], postedAt: null,
  };
}

describe("discovery coverage", () => {
  it("broadens exact senior titles without carrying the exact location into the fallback", () => {
    expect(buildBroaderSearchQuery('site:linkedin.com/jobs/view "VP of Product" "SF Bay Area" jobs', "VP of Product"))
      .toBe("site:linkedin.com/jobs/view product manager");
    expect(buildBroaderSearchQuery('site:hiringcafe.com/job "Director of Product Management" "SF Bay Area" jobs', "Director of Product Management"))
      .toBe("site:hiringcafe.com/job product manager");
    expect(buildBroaderSearchQuery("site:lever.co Head of Product San Francisco -internship", "VP of Product"))
      .toBe("site:lever.co product manager -internship");
    expect(buildBroaderSearchQuery("custom query", "VP of Product")).toBe("custom query");
  });

  it("uses a broader undated fallback when the focused search is empty", async () => {
    const fetch = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([job("new")]);
    const result = await searchBeyondKnown(['site:linkedin.com/jobs/view "VP of Product" "SF Bay Area"'], "test", 0, "past_week", new Set(), fetch, ["site:linkedin.com/jobs/view product manager"]);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("q")).toBe("site:linkedin.com/jobs/view product manager");
    expect(fetch.mock.calls[1][2]).toEqual({ offset: 0 });
    expect(result.candidates).toEqual([job("new")]);
    expect(result.requests).toBe(2);
  });

  it("does not broaden a source already returning enough unseen jobs", async () => {
    const fetch = vi.fn().mockResolvedValue([job("1"), job("2"), job("3"), job("4")]);
    await searchBeyondKnown(["focused"], "test", 0, "past_week", new Set(), fetch, ["broad"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("goes past a page of saved jobs and uses an undated fallback", async () => {
    const saved = job("saved");
    const fresh = job("new");
    const fetch = vi.fn().mockResolvedValueOnce([saved]).mockResolvedValueOnce([fresh]);
    const result = await searchBeyondKnown(["product jobs"], "test", 0, "past_week", new Set([saved.url]), fetch);
    expect(fetch.mock.calls[0][2]).toEqual({ offset: 0, freshness: "pw" });
    expect(fetch.mock.calls[1][2]).toEqual({ offset: 1 });
    expect(result.candidates).toEqual([saved, fresh]);
    expect(result.requests).toBe(2);
  });

  it("resumes at another page from a saved run counter", async () => {
    const fetch = vi.fn().mockResolvedValue([job("1"), job("2"), job("3"), job("4")]);
    await searchBeyondKnown(["product jobs"], "test", 4, "past_month", new Set(), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][2]).toEqual({ offset: 1, freshness: "pm" });
  });

  it("bounds requests even if every result is a duplicate", async () => {
    const fetch = vi.fn().mockResolvedValue([job("saved")]);
    const result = await searchBeyondKnown(["q1", "q2", "q3"], "test", 0, "any_time", new Set([job("saved").url]), fetch);
    expect(result.requests).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("preserves successful results and reports a failed fallback", async () => {
    const fetch = vi.fn().mockResolvedValueOnce([job("new")]).mockRejectedValueOnce(new Error("rate limited"));
    const result = await searchBeyondKnown(["jobs"], "test", 0, "past_month", new Set(), fetch);
    expect(result.candidates).toEqual([job("new")]);
    expect(result.errors).toEqual(["rate limited"]);
    expect(result.requests).toBe(2);
  });

  it("continues to other queries after one fails", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("outage"))
      .mockResolvedValue([job("1"), job("2"), job("3"), job("4")]);
    const result = await searchBeyondKnown(["bad", "good"], "test", 2, "any_time", new Set(), fetch);
    expect(result.candidates).toHaveLength(4);
    expect(result.errors).toEqual(["outage"]);
  });

  it("expires rejected history and invalidates it when preferences change", () => {
    const history = {
      valid: { context: "current", expiresAt: 200 },
      expired: { context: "current", expiresAt: 99 },
      old: { context: "old", expiresAt: 200 },
    };
    expect(Object.keys(pruneRejected(history, "current", 100))).toEqual(["valid"]);
    expect(pruneRejected(history, "changed", 100)).toEqual({});
  });

  it("bounds persisted rejection history", () => {
    const history = Object.fromEntries(Array.from({ length: 1100 }, (_, i) =>
      [String(i), { context: "a", expiresAt: 200 }]));
    expect(Object.keys(pruneRejected(history, "a", 100))).toHaveLength(1000);
  });
});
