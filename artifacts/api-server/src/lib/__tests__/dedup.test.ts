import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@workspace/db";
import { isFuzzyDuplicate, runDedupSweep, sweepDuplicatesOf } from "../dedup";

const state = vi.hoisted(() => ({
  postings: [] as any[], exceptions: [] as any[], fields: {} as any, conditions: [] as any[], affected: null as null | any[],
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (field: unknown, value: unknown) => ({ op: "eq", field, value }),
  inArray: (field: unknown, value: unknown) => ({ op: "in", field, value }),
  isNull: (field: unknown) => ({ op: "null", field }),
}));
vi.mock("@workspace/db", () => ({
  jobPostingsTable: { id: "id", userId: "userId", deletedAt: "deletedAt", closedAt: "closedAt", appliedAt: "appliedAt", dismissalUndoToken: "dismissalUndoToken" },
  jobDuplicateExceptionsTable: { userId: "exception.userId" },
  db: {
    select: vi.fn(() => ({ from: (table: any) => ({ where: vi.fn(async () => table.userId === "exception.userId" ? state.exceptions : state.postings) }) })),
    update: vi.fn(() => ({ set: (fields: any) => {
      state.fields = fields;
      return { where: (conditions: any[]) => {
        state.conditions = conditions;
        return { returning: async () => state.affected ?? conditions.find((c) => c.op === "in").value.map((id: number) => ({ id })) };
      } };
    } })),
  },
}));
const posting = (id: number, overrides = {}) => ({
  id, userId: "owner", title: "Product Manager", company: "Acme Inc", link: "https://jobs.lever.co/acme/req-1",
  fullDescription: "Original complete description", createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
  deletedAt: null, closedAt: null, appliedAt: null, dismissalUndoToken: null, ...overrides,
});
beforeEach(() => { vi.clearAllMocks(); state.postings = []; state.exceptions = []; state.fields = {}; state.conditions = []; state.affected = null; });

describe("identity-based imports and cleanup", () => {
  it("matches persisted cross-site identity while preserving the pair exception for saved jobs", async () => {
    const jobIdentity = {
      version: 1 as const, status: "verified" as const, reason: "verified_original_posting", observedAt: new Date().toISOString(),
      inputUrl: "https://lensa.com/jobs/copy-a", finalUrl: "https://lensa.com/jobs/copy-a",
      redirectChain: ["https://lensa.com/jobs/copy-a"], originalUrl: "https://jobs.lever.co/acme/req-1", signals: ["jsonld_jobposting_url"],
    };
    state.postings = [posting(1, { link: "https://lensa.com/jobs/copy-a", jobIdentity, appliedAt: new Date() })];
    expect(await isFuzzyDuplicate("owner", "Unrelated title wording", "Acme", { link: "https://partner.com/jobs/copy-b", jobIdentity }))
      .toMatchObject({ isDuplicate: true, matchedId: 1, wasApplied: true });
    state.exceptions = [{ postingIdLow: 1, postingIdHigh: 2 }];
    expect(await isFuzzyDuplicate("owner", "Product Manager", "Acme", { excludeId: 2, link: "https://partner.com/jobs/copy-b", jobIdentity }))
      .toEqual({ isDuplicate: false });
    expect(db.update).not.toHaveBeenCalled();
  });
  it("blocks identical title/company copies even without a link, without mutating history", async () => {
    state.postings = [posting(1)];
    expect(await isFuzzyDuplicate("owner", "Product Manager", "Acme Inc")).toMatchObject({ isDuplicate: true, matchedId: 1 });
    expect(db.update).not.toHaveBeenCalled();
  });
  it("does not block a different requisition at the same company", async () => {
    state.postings = [posting(1)];
    expect((await isFuzzyDuplicate("owner", "Product Manager", "Acme Inc", { link: "https://jobs.lever.co/acme/req-2" })).isDuplicate).toBe(false);
  });
  it("blocks a proven identical listing, including dismissed or applied ones", async () => {
    state.postings = [posting(1, { appliedAt: new Date() })];
    expect(await isFuzzyDuplicate("owner", "Different source wording", "Acme", { link: "https://jobs.lever.co/acme/req-1?utm_source=email" }))
      .toMatchObject({ isDuplicate: true, matchedId: 1, wasApplied: true });
  });
  it("does not remove the Uber/Cultura pair during cleanup", async () => {
    state.postings = [
      posting(1, { title: "Sr Product Manager - Uber Parcel", company: "Uber Technologies, Inc.", link: "https://uber.com/jobs/1" }),
      posting(2, { title: "Product Manager", company: "Cultura Technologies", link: "https://cultura.com/jobs/2", appliedAt: new Date() }),
    ];
    expect(await runDedupSweep("owner")).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("cleanup preserves full content and only removes proven identical listings", async () => {
    state.postings = [posting(1), posting(2, { appliedAt: new Date() }), posting(3, { link: "https://jobs.lever.co/acme/req-2" })];
    expect(await runDedupSweep("owner")).toBe(1);
    expect(state.fields).toMatchObject({ deletedBy: "sweep" });
    expect(state.fields).not.toHaveProperty("fullDescription");
    expect(state.conditions.find((c) => c.op === "in").value).toEqual([1]);
    expect(state.conditions.filter((c) => c.op === "null").map((c) => c.field))
      .toEqual(["deletedAt", "closedAt", "appliedAt", "dismissalUndoToken"]);
  });
  it("respects persistent pair exceptions without excluding unrelated pairs", async () => {
    state.postings = [posting(1), posting(2, { appliedAt: new Date() }), posting(3, { appliedAt: new Date(), link: "https://jobs.lever.co/acme/req-3" }), posting(4, { link: "https://jobs.lever.co/acme/req-3" })];
    state.exceptions = [{ postingIdLow: 1, postingIdHigh: 2 }];
    expect(await runDedupSweep("owner")).toBe(1);
    expect(state.conditions.find((c) => c.op === "in").value).toEqual([4]);
  });
  it("allows explicit cleanup of recent copies but protects tokenized reversible dismissals", async () => {
    state.postings = [
      posting(1, { createdAt: new Date() }), posting(2, { dismissalUndoToken: "undo" }),
      posting(3, { appliedAt: new Date() }),
    ];
    expect(await runDedupSweep("owner")).toBe(1);
    expect(state.conditions.find((c) => c.op === "in").value).toEqual([1]);
  });
  it("action-triggered cleanup anchors to the exact actioned posting", async () => {
    state.postings = [posting(1), posting(2, { appliedAt: new Date() }), posting(3, { link: "https://jobs.lever.co/acme/req-3", appliedAt: new Date() })];
    expect(await sweepDuplicatesOf("owner", "ignored title", "ignored employer", 3)).toBe(0);
    expect(await sweepDuplicatesOf("owner", "ignored title", "ignored employer", 2)).toBe(1);
  });
  it("returns the actual affected count", async () => {
    state.postings = [posting(1), posting(2, { appliedAt: new Date() })]; state.affected = [];
    expect(await runDedupSweep("owner")).toBe(0);
  });
});
