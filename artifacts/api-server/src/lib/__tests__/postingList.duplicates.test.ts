import { beforeEach, describe, expect, it, vi } from "vitest";
import { historicalDuplicateMatches } from "../duplicateVisibility";

const state = vi.hoisted(() => ({ postings: [] as any[], candidates: [] as any[], exceptions: new Set<string>() }));
vi.mock("../onlineDiscovery", () => ({ rankCandidate: vi.fn(), buildDiscoveryCriteria: vi.fn() }));
vi.mock("../jobLinkHealth", () => ({
  scheduleJobLinkChecks: vi.fn(), isConfirmedClosedAvailability: () => false,
}));
vi.mock("../dedup", () => ({
  loadHistoricalDuplicateMatches: async () => historicalDuplicateMatches(state.postings, state.exceptions),
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: {
    select: (projection: any) => {
      let table: any;
      const builder = {
        from: (value: any) => { table = value; return builder; },
        leftJoin: () => builder,
        where: () => builder,
        orderBy: async () => state.candidates,
        then: (resolve: (rows: any[]) => unknown, reject: (err: unknown) => unknown) => {
          const rows = table === actual.userProfilesTable || table === actual.onlineDiscoverySourcesTable ? []
            : projection?.posting ? state.candidates.map(posting => ({ posting, report: null, feedback: null, scoring: null })) : [];
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return builder;
    },
    update: vi.fn(() => { throw new Error("Read-only duplicate filtering must not mutate history"); }),
  } };
});
import { getPostingPage, listPostingPage } from "../postingList";

const posting = (id: number, overrides = {}) => ({
  id, title: "Product Manager", company: "Example", link: "https://jobright.ai/jobs/info/abc",
  appliedAt: null, deletedAt: null, closedAt: null, source: "manual", ...overrides,
});
beforeEach(() => {
  state.postings = [posting(1), posting(2, { appliedAt: new Date() }), posting(3, { link: null })];
  state.candidates = [state.postings[0], state.postings[2]];
  state.exceptions = new Set();
});
describe("paginated dashboard duplicate filtering", () => {
  it("returns an accurate total after filters and before page slicing", async () => {
    state.exceptions.add("1:2");
    const result = await getPostingPage("owner", { applied: false, limit: 1, offset: 1 });
    expect(result.total).toBe(2);
    expect(result.items.map(item => item.posting.id)).toEqual([3]);
  });
  it("retains the filtered total when the requested page is empty", async () => {
    const result = await getPostingPage("owner", { applied: false, limit: 25, offset: 25 });
    expect(result).toEqual({ total: 1, items: [] });
  });
  it("removes confirmed historical copies before pagination", async () => {
    const result = await listPostingPage("owner", { applied: false, limit: 1, offset: 0 });
    expect(result.map(item => item.posting.id)).toEqual([3]);
  });
  it("makes copies recoverable in Filtered with their historical anchor", async () => {
    const result = await listPostingPage("owner", { hidden: true });
    expect(result.map(item => item.posting.id)).toEqual([1]);
    expect(result[0].filterReason).toMatchObject({
      byDuplicate: true, duplicateMatches: [{ id: 2, title: "Product Manager", company: "Example", status: "applied" }],
    });
  });
  it("restores Active visibility immediately after a pair-specific exception", async () => {
    state.exceptions.add("1:2");
    expect((await listPostingPage("owner", { applied: false })).map(item => item.posting.id)).toEqual([1, 3]);
    expect(await listPostingPage("owner", { hidden: true })).toEqual([]);
  });
  it("does not suppress applied or archived history", async () => {
    state.candidates = [state.postings[1]];
    expect((await listPostingPage("owner", { applied: true })).map(item => item.posting.id)).toEqual([2]);
    state.candidates = [posting(4, { deletedAt: new Date() })];
    expect((await listPostingPage("owner", { archived: true })).map(item => item.posting.id)).toEqual([4]);
  });
});
