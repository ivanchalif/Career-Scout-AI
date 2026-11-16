import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  postings: [] as any[], exceptions: [] as any[], writes: 0,
  reads: [] as { fields: string[]; ids: number[] }[],
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...await importOriginal<any>(),
  eq: (field: any, value: any) => ({ op: "eq", field: field.name, value }),
  inArray: (field: any, value: any) => ({ op: "in", field: field.name, value }),
  isNull: (field: any) => ({ op: "null", field: field.name }),
  and: (...conditions: any[]) => conditions,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const property = (name: string) => name === "kind" ? "dismissalReason"
    : name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return { ...actual, db: {
    select: (selection?: Record<string, any>) => ({ from: (table: any) => ({
      leftJoin() { return this; },
      where: async (condition: any) => {
      const rows = table === actual.jobDuplicateExceptionsTable ? state.exceptions : state.postings;
      const clauses = Array.isArray(condition) ? condition : [condition];
      const matched = rows.filter((row) => clauses.every((c: any) => {
        const value = row[property(c.field)];
        return c.op === "eq" ? value === c.value : c.op === "in" ? c.value.includes(value) : value == null;
      }));
      state.reads.push({ fields: Object.keys(selection ?? {}), ids: matched.map(row => row.id) });
      return selection ? matched.map(row => Object.fromEntries(
        Object.entries(selection).map(([key, column]) => [key, row[property(column.name)]]),
      )) : matched;
    } }) }),
    insert: () => ({ values: (row: any) => ({ onConflictDoNothing: async () => {
      if (!state.exceptions.some((e) => e.userId === row.userId && e.postingIdLow === row.postingIdLow && e.postingIdHigh === row.postingIdHigh)) {
        state.exceptions.push(row); state.writes++;
      }
    } }) }),
  } };
});
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = "owner"; next(); },
}));
vi.mock("../../lib/scoringService", () => ({
  scorePosting: vi.fn(), scorePostingBackground: vi.fn(), extractJobListings: vi.fn(),
}));
const posting = (id: number, overrides = {}) => ({
  id, userId: "owner", title: "Senior Product Manager (AI)", company: "Acme Technologies",
  location: "San Francisco, CA", link: null, appliedAt: null, deletedAt: null, closedAt: null,
  fullDescription: "", salaryMin: null, salaryMax: null, createdAt: new Date(), ...overrides,
});
const app = express();
beforeAll(async () => {
  const { default: router } = await import("../postings");
  app.use(express.json()); app.use("/api", router);
}, 30_000);
beforeEach(() => { state.postings = []; state.exceptions = []; state.writes = 0; state.reads = []; });

describe("pair-specific duplicate review API", () => {
  it("retrieves descriptions only for plausible owned candidates, including off-page identity matches", async () => {
    const originalUrl = "https://jobs.lever.co/acme/original";
    state.postings = [
      posting(1, { company: "Acme Inc.", jobIdentity: { version: 1, status: "verified", originalUrl, signals: [] } }),
      posting(2, { company: "Other label", title: "Different title", link: originalUrl, appliedAt: new Date() }),
      posting(3, { title: "Junior Accountant" }),
      posting(4, { company: "Unrelated", fullDescription: "x".repeat(100_000) }),
      posting(5, { deletedAt: new Date(), dismissalReason: "duplicate" }),
      posting(6, { deletedAt: new Date(), deletedBy: "duplicate" }),
      posting(7, { closedAt: new Date() }),
      posting(8, { userId: "other-owner" }),
      posting(9),
    ];
    state.exceptions = [{ userId: "owner", postingIdLow: 1, postingIdHigh: 9 }];
    const result = await request(app).get("/api/postings/near-duplicates?postingIds=1,8").expect(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({ id1: 1, id2: 2, confidence: "duplicate" });
    expect(state.reads[0].fields).not.toContain("fullDescription");
    expect(state.reads.filter(read => read.fields.includes("fullDescription"))).toEqual([
      { fields: ["id", "fullDescription"], ids: [1, 2] },
    ]);
    expect(state.writes).toBe(0);
  });

  it("does not load any descriptions when subjects have no plausible partners", async () => {
    state.postings = [posting(1), posting(2, { title: "Junior Accountant" })];
    expect((await request(app).get("/api/postings/near-duplicates?postingIds=1").expect(200)).body).toEqual([]);
    expect(state.reads.some(read => read.fields.includes("fullDescription"))).toBe(false);
  });

  it("scopes subjects to the current page but compares against off-page owned jobs", async () => {
    state.postings = [
      ...Array.from({ length: 45 }, (_, index) => [
        posting(index * 2 + 1, { company: `Employer ${index}` }),
        posting(index * 2 + 2, { company: `Employer ${index}` }),
      ]).flat(),
      posting(1000, { userId: "other-owner" }),
    ];
    const response = await request(app).get("/api/postings/near-duplicates?postingIds=89,1000").expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id1: 89, id2: 90, confidence: "review" });
    expect(state.writes).toBe(0);
  });

  it("returns coverage for every visible member of an active-only group", async () => {
    state.postings = [posting(1), posting(2), posting(3)];
    const response = await request(app).get("/api/postings/near-duplicates?postingIds=1,2,3").expect(200);
    expect(new Set(response.body.flatMap((pair: any) => [pair.id1, pair.id2]))).toEqual(new Set([1, 2, 3]));
    expect(state.writes).toBe(0);
  });

  it.each(["", "0", "-1", "1,x", "1.5", "9007199254740992", Array.from({ length: 101 }, (_, i) => i + 1).join(",")])(
    "rejects an invalid visible-ID scope %s", async ids => {
      await request(app).get("/api/postings/near-duplicates").query({ postingIds: ids }).expect(400);
      expect(state.writes).toBe(0);
    },
  );

  it("does not suggest the retained active copy against a discarded duplicate", async () => {
    state.postings = [posting(1), posting(2, { deletedAt: new Date(), dismissalReason: "duplicate" })];
    const response = await request(app).get("/api/postings/near-duplicates").expect(200);
    expect(response.body).toEqual([]);
    expect(state.writes).toBe(0);
  });
  it("includes dismissed history in review without modifying it", async () => {
    state.postings = [posting(1), posting(2, { title: "Sr Product Manager (AI)", deletedAt: new Date() })];
    const response = await request(app).get("/api/postings/near-duplicates").expect(200);
    expect(response.body[0]).toMatchObject({ id1: 1, id2: 2, confidence: "review" });
    expect(response.body[0].deleted_at2).toBeTruthy();
    expect(state.writes).toBe(0);
  });
  it("blocks manual copies of applied/dismissed provider IDs with an explanatory conflict", async () => {
    state.postings = [posting(2, { deletedAt: new Date(), link: "https://jobright.ai/jobs/info/abc?imp_id=old" })];
    const response = await request(app).post("/api/postings").send({
      title: "Product Manager", company: "Acme Technologies",
      link: "https://jobright.ai/jobs/info/abc?imp_id=new", fullDescription: "Description",
    }).expect(409);
    expect(response.body.existingPostingId).toBe(2);
    expect(state.writes).toBe(0);
  });
  it("never offers the reported Uber/Cultura pair", async () => {
    state.postings = [
      posting(1, { title: "Sr Product Manager - Uber Parcel", company: "Uber Technologies, Inc." }),
      posting(2, { title: "Product Manager", company: "Cultura Technologies", appliedAt: new Date() }),
    ];
    expect((await request(app).get("/api/postings/near-duplicates").expect(200)).body).toEqual([]);
  });
  it("shows evidence and saves a symmetric exception across repeated requests", async () => {
    state.postings = [posting(1), posting(2, { title: "Sr Product Manager (AI)", appliedAt: new Date() })];
    const before = await request(app).get("/api/postings/near-duplicates").expect(200);
    expect(before.body[0]).toMatchObject({ id1: 1, id2: 2, confidence: "review" });
    expect(before.body[0].evidence.length).toBeGreaterThan(0);
    await request(app).post("/api/postings/not-duplicates").send({ postingId: 2, otherPostingId: 1 }).expect(204);
    await request(app).post("/api/postings/not-duplicates").send({ postingId: 1, otherPostingId: 2 }).expect(204);
    expect(state.writes).toBe(1);
    expect(state.exceptions).toEqual([{ userId: "owner", postingIdLow: 1, postingIdHigh: 2 }]);
    expect((await request(app).get("/api/postings/near-duplicates").expect(200)).body).toEqual([]);
    // An exception for 1:2 does not suppress other comparisons involving job 1.
    state.postings.push(posting(3, { title: "Sr Product Manager (AI)", appliedAt: new Date() }));
    const after = await request(app).get("/api/postings/near-duplicates").expect(200);
    expect(after.body[0]).toMatchObject({ id1: 1, id2: 3 });
    expect(state.postings.every((p) => !p.deletedAt)).toBe(true);
  });
  it("rejects foreign-user pairs without saving anything", async () => {
    state.postings = [posting(1), posting(2, { userId: "other-owner" })];
    await request(app).post("/api/postings/not-duplicates").send({ postingId: 1, otherPostingId: 2 }).expect(404);
    expect(state.writes).toBe(0);
  });
  it("does not ask for review of exact title/company matches", async () => {
    state.postings = [posting(1), posting(2), posting(3, { appliedAt: new Date() })];
    expect((await request(app).get("/api/postings/near-duplicates").expect(200)).body).toEqual([]);
    expect(state.writes).toBe(0);
  });
  it("returns a review for identical jobs when both are active, without changing either", async () => {
    state.postings = [posting(1), posting(2)];
    const response = await request(app).get("/api/postings/near-duplicates").expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id1: 1, id2: 2, confidence: "review" });
    expect(state.postings.every(posting => !posting.deletedAt && !posting.appliedAt)).toBe(true);
    expect(state.writes).toBe(0);
  });
  it.each([
    { postingId: 1, otherPostingId: 1 }, { postingId: -1, otherPostingId: 2 },
    { postingId: "1", otherPostingId: 2 }, { postingId: 1 }, {},
  ])("rejects malformed pair inputs %j", async (body) => {
    await request(app).post("/api/postings/not-duplicates").send(body).expect(400);
    expect(state.writes).toBe(0);
  });
});
