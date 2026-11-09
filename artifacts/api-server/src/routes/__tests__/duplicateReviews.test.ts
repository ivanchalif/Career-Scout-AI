import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({ postings: [] as any[], exceptions: [] as any[], writes: 0 }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...await importOriginal<any>(),
  eq: (field: any, value: any) => ({ op: "eq", field: field.name, value }),
  inArray: (field: any, value: any) => ({ op: "in", field: field.name, value }),
  isNull: (field: any) => ({ op: "null", field: field.name }),
  and: (...conditions: any[]) => conditions,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const property: Record<string, string> = {
    user_id: "userId", deleted_at: "deletedAt", closed_at: "closedAt", id: "id",
  };
  return { ...actual, db: {
    select: () => ({ from: (table: any) => ({ where: async (condition: any) => {
      const rows = table === actual.jobDuplicateExceptionsTable ? state.exceptions : state.postings;
      const clauses = Array.isArray(condition) ? condition : [condition];
      return rows.filter((row) => clauses.every((c: any) => {
        const value = row[property[c.field] ?? c.field];
        return c.op === "eq" ? value === c.value : c.op === "in" ? c.value.includes(value) : value == null;
      }));
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
  salaryMin: null, salaryMax: null, createdAt: new Date(), ...overrides,
});
const app = express();
beforeAll(async () => {
  const { default: router } = await import("../postings");
  app.use(express.json()); app.use("/api", router);
}, 30_000);
beforeEach(() => { state.postings = []; state.exceptions = []; state.writes = 0; });

describe("pair-specific duplicate review API", () => {
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
