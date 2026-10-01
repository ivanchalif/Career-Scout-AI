import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Request, Response, NextFunction } from "express";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ type: "eq", field, value })),
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  or: vi.fn((...conditions: unknown[]) => ({ type: "or", conditions })),
  ilike: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  isNull: vi.fn((field: unknown) => ({ type: "isNull", field })),
  isNotNull: vi.fn((field: unknown) => ({ type: "isNotNull", field })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  jobPostingsTable: {
    id: "posting.id",
    userId: "posting.userId",
    deletedAt: "posting.deletedAt",
    closedAt: "posting.closedAt",
    appliedAt: "posting.appliedAt",
    dismissalUndoToken: "posting.dismissalUndoToken",
    dismissalPreviousFeedback: "posting.dismissalPreviousFeedback",
  },
  matchReportsTable: {},
  jobPostingFeedbackTable: {
    userId: "feedback.userId",
    jobPostingId: "feedback.jobPostingId",
    kind: "feedback.kind",
    createdAt: "feedback.createdAt",
  },
  userProfilesTable: {},
  gmailConnectionsTable: {},
}));

vi.mock("../../lib/scoringService", () => ({
  scorePosting: vi.fn(),
  scorePostingBackground: vi.fn(),
  extractJobListings: vi.fn(),
  rescoreAllPostings: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId?: string }).userId = "test-user-id";
    next();
  },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next(),
  getAuth: () => ({ userId: "test-user-id" }),
}));

import { db } from "@workspace/db";
import { scorePosting } from "../../lib/scoringService";

const dbSelect = db.select as ReturnType<typeof vi.fn>;
const dbTransaction = db.transaction as ReturnType<typeof vi.fn>;
const mockScorePosting = scorePosting as ReturnType<typeof vi.fn>;

const FAKE_POSTING = {
  id: 42,
  userId: "test-user-id",
  title: "Senior React Engineer",
  company: "TechCorp",
  fullDescription:
    "Looking for a Senior React Engineer with TypeScript and GraphQL experience.",
  requiredSkills: [],
  niceToHaveSkills: [],
  extractedSkills: [],
  location: null,
  remoteType: "remote",
  salaryMin: 130000,
  salaryMax: 160000,
  minYearsExperience: null,
  link: null,
  source: "manual",
  gmailMessageId: null,
  appliedAt: null,
  deletedAt: null,
  createdAt: new Date(),
};

const FAKE_REPORT = {
  id: 1,
  jobPostingId: 42,
  userId: "test-user-id",
  fitScore: 72,
  reasoning: "Good match on React and TypeScript, missing GraphQL.",
  matchedSkills: ["TypeScript", "React"],
  missingSkills: ["GraphQL"],
  compensationGap: 5000,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

async function getRouter() {
  const { default: postingsRouter } = await import("../postings");
  const app = express();
  app.use(express.json());
  app.use(postingsRouter);
  return app;
}

describe("POST /postings/:id/analyze — integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with the correct AnalyzePostingResponse shape", async () => {
    dbSelect.mockReturnValue(makeSelectChain([FAKE_POSTING]));
    mockScorePosting.mockResolvedValue({ report: FAKE_REPORT });

    const app = await getRouter();
    const res = await request(app).post("/postings/42/analyze");

    expect(res.status).toBe(200);
    expect(typeof res.body.fitScore).toBe("number");
    expect(res.body.fitScore).toBeGreaterThanOrEqual(0);
    expect(res.body.fitScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.matchedSkills)).toBe(true);
    expect(Array.isArray(res.body.missingSkills)).toBe(true);
    expect(typeof res.body.reasoning).toBe("string");
  });

  it("calls scorePosting with forceParse: true", async () => {
    dbSelect.mockReturnValue(makeSelectChain([FAKE_POSTING]));
    mockScorePosting.mockResolvedValue({ report: FAKE_REPORT });

    const app = await getRouter();
    await request(app).post("/postings/42/analyze");

    expect(mockScorePosting).toHaveBeenCalledWith(42, "test-user-id", {
      forceParse: true,
    });
  });

  it("returns 404 when the posting does not exist", async () => {
    dbSelect.mockReturnValue(makeSelectChain([]));

    const app = await getRouter();
    const res = await request(app).post("/postings/9999/analyze");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 for a non-numeric posting id", async () => {
    const app = await getRouter();
    const res = await request(app).post("/postings/not-a-number/analyze");

    expect(res.status).toBe(400);
  });

  it("returns 500 when scorePosting throws an error", async () => {
    dbSelect.mockReturnValue(makeSelectChain([FAKE_POSTING]));
    mockScorePosting.mockRejectedValue(new Error("LLM unavailable"));

    const app = await getRouter();
    const res = await request(app).post("/postings/42/analyze");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error", "LLM unavailable");
  });

  it("graceful fallback: persists a non-null score even when LLM JSON is malformed", async () => {
    dbSelect.mockReturnValue(makeSelectChain([FAKE_POSTING]));

    const fallbackReport = { ...FAKE_REPORT, fitScore: 33 };
    mockScorePosting.mockResolvedValue({ report: fallbackReport });

    const app = await getRouter();
    const res = await request(app).post("/postings/42/analyze");

    expect(res.status).toBe(200);
    expect(res.body.fitScore).not.toBeNull();
    expect(typeof res.body.fitScore).toBe("number");
    expect(res.body.fitScore).toBe(33);
  });
});

describe("standalone posting feedback while dismissals are active", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function makeFeedbackApp() {
    const { default: postingsRouter } = await import("../postings");
    const app = express();
    app.use(express.json());
    app.use(postingsRouter);
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: error.message });
    });
    return app;
  }

  function updateHasNullGuard(update: {
    where: ReturnType<typeof vi.fn>;
  }, field: string): boolean {
    const predicate = update.where.mock.calls[0]?.[0] as {
      conditions?: Array<{ type: string; field?: unknown }>;
    } | undefined;
    return predicate?.conditions?.some(
      (condition) => condition.type === "isNull" && condition.field === field,
    ) ?? false;
  }

  function makeFeedbackTransaction(posting: { id: number; deletedAt: Date | null }, feedback?: unknown) {
    const tx = {
      select: vi.fn(() => {
        const chain = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          for: vi.fn().mockResolvedValue([posting]),
        };
        return chain;
      }),
      insert: vi.fn(() => {
        const chain = {
          values: vi.fn(() => chain),
          onConflictDoUpdate: vi.fn(() => chain),
          returning: vi.fn().mockResolvedValue(feedback ? [feedback] : []),
        };
        return chain;
      }),
      delete: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    };
    dbTransaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));
    return tx;
  }

  it("prevents stale standalone feedback edits and deletes while dismissed", async () => {
    const tx = makeFeedbackTransaction({ id: 42, deletedAt: new Date() });
    const app = await makeFeedbackApp();

    const setResponse = await request(app)
      .put("/postings/42/feedback")
      .send({ kind: "not_my_role" });
    const deleteResponse = await request(app).delete("/postings/42/feedback");

    expect(setResponse.status).toBe(409);
    expect(deleteResponse.status).toBe(409);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("keeps existing feedback choices available for active postings", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    const tx = makeFeedbackTransaction({ id: 42, deletedAt: null }, {
      kind: "more_like_this",
      createdAt,
    });
    const app = await makeFeedbackApp();

    const response = await request(app)
      .put("/postings/42/feedback")
      .send({ kind: "more_like_this" });

    expect(response.status, response.body.error).toBe(200);
    expect(response.body).toEqual({
      kind: "more_like_this",
      createdAt: createdAt.toISOString(),
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it("restores legacy postings without rewriting dismissal snapshot fields", async () => {
    const update = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 42 }]),
    };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update);
    const app = await makeFeedbackApp();

    const response = await request(app).patch("/postings/42/restore");

    expect(response.status).toBe(200);
    expect(update.set).toHaveBeenCalledWith({ deletedAt: null });
    expect(updateHasNullGuard(update, "posting.dismissalUndoToken")).toBe(true);
  });

  it("rejects generic restore for a token-bearing dismissal without clearing its snapshot", async () => {
    const update = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update);
    const snapshot = { kind: "more_like_this", createdAt: "2024-11-10T11:12:13.000Z" };
    dbSelect.mockReturnValue(makeSelectChain([{
      id: 42,
      dismissalUndoToken: "live-token",
      dismissalPreviousFeedback: snapshot,
      fullDescription: "Dismissed content still retained",
    }]));
    const app = await makeFeedbackApp();

    const response = await request(app).patch("/postings/42/restore");

    expect(response.status).toBe(409);
    expect(update.set).toHaveBeenCalledWith({ deletedAt: null });
    expect(updateHasNullGuard(update, "posting.dismissalUndoToken")).toBe(true);
  });

  it("rejects legacy delete if a dismissal token wins the check-then-write race", async () => {
    const update = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update);
    dbSelect.mockReturnValue(makeSelectChain([{
      id: 42,
      dismissalUndoToken: "live-token",
      dismissalPreviousFeedback: { kind: "more_like_this", createdAt: "2024-11-10T11:12:13.000Z" },
      fullDescription: "Dismissed content still retained",
    }]));
    const app = await makeFeedbackApp();

    const response = await request(app).delete("/postings/42");

    expect(response.status).toBe(409);
    expect(updateHasNullGuard(update, "posting.deletedAt")).toBe(true);
    expect(updateHasNullGuard(update, "posting.dismissalUndoToken")).toBe(true);
  });

  it("guards flag-as-duplicate against a dismissal committed after its initial read", async () => {
    const update = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update);
    dbSelect
      .mockReturnValueOnce(makeSelectChain([{
        ...FAKE_POSTING,
        dismissalUndoToken: null,
      }]))
      .mockReturnValueOnce(makeSelectChain([{
        ...FAKE_POSTING,
        deletedAt: new Date(),
        dismissalUndoToken: "live-token",
      }]));
    const app = await makeFeedbackApp();

    const response = await request(app).post("/postings/42/flag-duplicate");

    expect(response.status).toBe(409);
    expect(updateHasNullGuard(update, "posting.deletedAt")).toBe(true);
    expect(updateHasNullGuard(update, "posting.dismissalUndoToken")).toBe(true);
  });
});
