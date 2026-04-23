import { Router, type IRouter } from "express";
import { eq, and, avg, isNotNull } from "drizzle-orm";
import { db, jobPostingsTable, matchReportsTable, userProfilesTable, gmailConnectionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as string;

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const [gmailConn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  const postings = await db
    .select()
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId));

  const totalPostings = postings.length;

  const reports = await db
    .select()
    .from(matchReportsTable)
    .where(eq(matchReportsTable.userId, userId));

  const scoredReports = reports.filter((r) => r.fitScore != null);
  const avgFitScore =
    scoredReports.length > 0
      ? scoredReports.reduce((sum, r) => sum + (r.fitScore ?? 0), 0) / scoredReports.length
      : null;

  const postingMap = new Map(postings.map((p) => [p.id, p]));
  const reportMap = new Map(reports.map((r) => [r.jobPostingId, r]));

  const postingsWithReports = postings
    .map((posting) => ({
      posting,
      report: reportMap.get(posting.id) ?? null,
    }))
    .sort((a, b) => {
      const sa = a.report?.fitScore ?? -1;
      const sb = b.report?.fitScore ?? -1;
      return sb - sa;
    });

  const topMatches = postingsWithReports.slice(0, 5);

  res.json(
    GetDashboardSummaryResponse.parse({
      totalPostings,
      avgFitScore,
      topMatches,
      hasProfile: !!profile,
      gmailConnected: !!gmailConn,
    }),
  );
});

export default router;
