import { describe, expect, it } from "vitest";
import { historicalDuplicateMatches, type HistoricalPosting } from "../duplicateVisibility";
import { pairKey } from "../duplicatePolicy";

const posting = (id: number, overrides: Partial<HistoricalPosting> = {}): HistoricalPosting => ({
  id, title: "Product Manager", company: "Example",
  link: "https://jobright.ai/jobs/info/abc", appliedAt: null, deletedAt: null, closedAt: null, ...overrides,
});

describe("read-only duplicate visibility", () => {
  it.each(["appliedAt", "deletedAt"] as const)("hides copies of %s history immediately without mutating either record", (field) => {
    const rows = [posting(1), posting(2, { [field]: new Date() })];
    const before = structuredClone(rows);
    expect(historicalDuplicateMatches(rows, new Set()).get(1)?.map(p => p.id)).toEqual([2]);
    expect(rows).toEqual(before);
  });
  it("keeps applied and deleted records accessible, even when they share identity", () => {
    const rows = [posting(1, { appliedAt: new Date() }), posting(2, { deletedAt: new Date() })];
    expect(historicalDuplicateMatches(rows, new Set()).size).toBe(0);
  });
  it("keeps one stable original when exact copies are both active", () => {
    const rows = [posting(1), posting(2)];
    expect(historicalDuplicateMatches(rows.reverse(), new Set()).get(2)?.map(p => p.id)).toEqual([1]);
    expect(historicalDuplicateMatches(rows, new Set(["1:2"])).size).toBe(0);
  });
  it("requires an exception for every actual historical match, never a global exemption", () => {
    const rows = [posting(1), posting(2, { deletedAt: new Date() }), posting(3, { appliedAt: new Date() })];
    expect(historicalDuplicateMatches(rows, new Set([pairKey(1, 2)])).get(1)?.map(p => p.id)).toEqual([3]);
    expect(historicalDuplicateMatches(rows, new Set([pairKey(1, 2), pairKey(1, 3)])).size).toBe(0);
  });
  it("hides exact title/company copies regardless of links, but preserves actual discrepancies", () => {
    for (const link of [null, "https://example.com/careers", "https://jobright.ai/jobs/info/different"]) {
      const result = historicalDuplicateMatches([posting(1, { link }), posting(2, { deletedAt: new Date() })], new Set());
      expect(result.has(1)).toBe(link !== "https://jobright.ai/jobs/info/different");
    }
  });
  it("never changes lifecycle or descriptions when automatically classifying active copies", () => {
    const rows = [posting(1, { link: null }), posting(2, { link: null }), posting(3, { title: "Senior Product Manager", link: null })];
    const before = structuredClone(rows);
    const matches = historicalDuplicateMatches(rows, new Set());
    expect([...matches.keys()]).toEqual([2]);
    expect(rows).toEqual(before);
  });
  it("does not use a closed-only record as an applied/dismissed anchor", () => {
    expect(historicalDuplicateMatches([posting(1), posting(2, { closedAt: new Date() })], new Set()).size).toBe(0);
  });
});
