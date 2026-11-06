import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import type { NextFunction, Request, Response } from "express";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
}));
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
      gmailMessageId: null, senderName: null, appliedAt: null, location: "San Francisco, CA",
      remoteType: "hybrid", deletedAt: null, deletedBy: null, closedAt: null, createdAt: new Date(),
    };
    const report = {
      id: 1, jobPostingId: 7, userId: "test-user", fitScore: 91, reasoning: "Strong match.",
      compensationGap: null, matchedSkills: ["Product"], missingSkills: [], createdAt: new Date(), updatedAt: new Date(),
    };
    dbSelect
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain([posting]))
      .mockReturnValueOnce(chain([report]))
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
  it.each([true, false])("keeps summary counts aligned with the location visibility preference (%s)", async (enabled) => {
    const postings = [
      { id: 1, title: "Engineer", location: "New York, NY", remoteType: "onsite", company: "Example", appliedAt: null },
      { id: 2, title: "Engineer", location: "San Francisco, CA", remoteType: "remote", company: "Example", appliedAt: null },
      { id: 3, title: "Engineer", location: "New York, NY", remoteType: "remote", company: "Example", appliedAt: null },
      { id: 4, title: "Engineer", location: null, remoteType: "onsite", company: "Example", appliedAt: null },
      { id: 5, title: "Engineer", location: "New York, NY", remoteType: null, company: "Example", appliedAt: null },
    ];
    dbSelect
      .mockReturnValueOnce(chain([{ companyFilterSettings: { mode: "off", companies: [], bayAreaNonRemoteOnly: enabled } }]))
      .mockReturnValueOnce(chain([]))
      .mockReturnValueOnce(chain(postings))
      .mockReturnValueOnce(chain([]));
    const { default: dashboardRouter } = await import("../dashboard");
    const app = express();
    app.use(dashboardRouter);
    const response = await request(app).get("/dashboard/summary");
    expect(response.status).toBe(200);
    expect(response.body.totalPostings).toBe(enabled ? 3 : 5);
  });
});