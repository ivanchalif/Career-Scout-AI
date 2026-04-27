import { Router, type IRouter } from "express";
import { eq, isNull, isNotNull } from "drizzle-orm";
import { db, jobPostingsTable, matchReportsTable, userProfilesTable, gmailConnectionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const [gmailConn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  // Only count non-deleted, non-applied (active) postings
  const activePostings = await db
    .select({ id: jobPostingsTable.id })
    .from(jobPostingsTable)
    .where(
      eq(jobPostingsTable.userId, userId),
    )
    .then((rows) => rows); // fetch all, filter in JS to reuse for scoring below

  const allNonDeleted = await db
    .select()
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId))
    .then((rows) => rows.filter((p) => !p.deletedAt));

  const activeOnly = allNonDeleted.filter((p) => !p.appliedAt);
  const totalPostings = activeOnly.length;

  const activeIds = new Set(activeOnly.map((p) => p.id));

  const reports = await db
    .select()
    .from(matchReportsTable)
    .where(eq(matchReportsTable.userId, userId));

  // Avg fit score across active (non-deleted, non-applied) scored postings
  const activeReports = reports.filter((r) => activeIds.has(r.jobPostingId) && r.fitScore != null);
  const avgFitScore =
    activeReports.length > 0
      ? activeReports.reduce((sum, r) => sum + (r.fitScore ?? 0), 0) / activeReports.length
      : null;

  // Strong matches: active jobs scoring >= 70
  const strongMatches = activeReports.filter((r) => (r.fitScore ?? 0) >= 70).length;

  res.json(
    GetDashboardSummaryResponse.parse({
      totalPostings,
      avgFitScore,
      strongMatches,
      hasProfile: !!profile,
      gmailConnected: !!gmailConn,
    }),
  );
});

export default router;
