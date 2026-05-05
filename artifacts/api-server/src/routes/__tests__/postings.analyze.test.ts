import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Request, Response, NextFunction } from "express";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
  ilike: vi.fn().mockReturnValue({}),
  gte: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  jobPostingsTable: {},
  matchReportsTable: {},
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
