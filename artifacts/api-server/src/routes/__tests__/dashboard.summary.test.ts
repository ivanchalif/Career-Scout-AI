import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import type { NextFunction, Request, Response } from "express";

vi.mock("drizzle-orm", () => ({ eq: vi.fn().mockReturnValue({}) }));
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  jobPostingsTable: {},
  matchReportsTable: {},
  userProfilesTable: {},
  gmailConnectionsTable: {},
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId?: string }).userId = "test-user";
    next();
  },
}));

import { db } from "@workspace/db";

const dbSelect = db.select as ReturnType<typeof vi.fn>;
const chain = (rows: unknown[]) => ({
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(rows),
});

describe("GET /dashboard/summary", () => {
  it("returns the required topMatches contract field", async () => {
    const posting = {
      id: 7, userId: "test-user", title: "Product Manager", company: "Example",
      link: null, fullDescription: "Own product strategy and execution.", extractedSkills: [],
      salaryMin: null, salaryMax: null, source: "arbeitnow", sourcePostedAt: null,
      gmailMessageId: null, senderName: null, appliedAt: null, location: "Remote",
      remoteType: "remote", deletedAt: null, deletedBy: null, closedAt: null, createdAt: new Date(),
    };
    const report = {
      id: 1, jobPostingId: 7, userId: "test-user", fitScore: 91, reasoning: "Strong match.",
      compensationGap: null, matchedSkills: ["Product"], missingSkills: [], createdAt: new Date(), updatedAt: new Date(),
    };
    dbSelect
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([posting]))
      .mockReturnValueOnce(chain([report]));

    const { default: dashboardRouter } = await import("../dashboard");
    const app = express();
    app.use(dashboardRouter);
    const response = await request(app).get("/dashboard/summary");

    expect(response.status).toBe(200);
    expect(response.body.topMatches).toHaveLength(1);
    expect(response.body.topMatches[0].posting.id).toBe(7);
    expect(response.body.topMatches[0].report.fitScore).toBe(91);
  });
});