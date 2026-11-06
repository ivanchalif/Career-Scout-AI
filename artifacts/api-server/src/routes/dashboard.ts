import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, jobPostingsTable, matchReportsTable, userProfilesTable, gmailConnectionsTable } from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { postingFilterReason } from "../lib/postingFilters";
import { and, inArray } from "drizzle-orm";
import { historicalDuplicateMatches } from "../lib/duplicateVisibility";
import { loadDuplicateExceptions } from "../lib/dedup";

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

  const allPostings = await db
    .select({
      id: jobPostingsTable.id, title: jobPostingsTable.title, company: jobPostingsTable.company,
      link: jobPostingsTable.link, location: jobPostingsTable.location, remoteType: jobPostingsTable.remoteType,
      appliedAt: jobPostingsTable.appliedAt, deletedAt: jobPostingsTable.deletedAt, closedAt: jobPostingsTable.closedAt,
    })
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId));

  // Mirror the same filter chain the list endpoint uses
  const duplicates = historicalDuplicateMatches(allPostings, await loadDuplicateExceptions(userId));
  const activeOnly = allPostings.filter((p) => !p.deletedAt && !p.closedAt && !p.appliedAt
    && !duplicates.has(p.id) && !postingFilterReason(p, profile));
  const appliedPostings = allPostings.filter((p) => !p.deletedAt && !p.closedAt && !!p.appliedAt && !postingFilterReason(p, profile)).length;
  const archivedPostings = allPostings.filter((p) => !!p.deletedAt || !!p.closedAt).length;

  // CONTRACT: every stat returned by this endpoint MUST be derived from `activeOnly`
  // (or a subset of it via `activeIds`). Never compute a stat from `allPostings` directly,
  // as that would silently bypass the company and title keyword filters from the user's profile.
  const totalPostings = activeOnly.length;
  const activeIds = new Set(activeOnly.map((p) => p.id));

  const reports = await db
    .select({ jobPostingId: matchReportsTable.jobPostingId, fitScore: matchReportsTable.fitScore, updatedAt: matchReportsTable.updatedAt })
    .from(matchReportsTable)
    .where(eq(matchReportsTable.userId, userId));

  // Avg fit score across active scored postings (respects all profile filters via activeIds)
  const activeReports = reports.filter((r) => activeIds.has(r.jobPostingId) && r.fitScore != null);
  const avgFitScore =
    activeReports.length > 0
      ? activeReports.reduce((sum, r) => sum + (r.fitScore ?? 0), 0) / activeReports.length
      : null;

  // Strong matches: active jobs scoring >= 85
  const strongMatches = activeReports.filter((r) => (r.fitScore ?? 0) >= 85).length;
  const topIds = activeReports
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1))
    .slice(0, 5).map((report) => report.jobPostingId);
  const topPostings = topIds.length ? await db.select().from(jobPostingsTable)
    .where(and(eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, topIds))) : [];
  const topReports = topIds.length ? await db.select().from(matchReportsTable)
    .where(and(eq(matchReportsTable.userId, userId), inArray(matchReportsTable.jobPostingId, topIds))) : [];
  const activePostingById = new Map(topPostings.map((posting) => [posting.id, posting]));
  const topMatches = topReports
    .sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1))
    .flatMap((report) => {
      const posting = activePostingById.get(report.jobPostingId);
      return posting ? [{
        posting,
        report,
        scoreStatus: profile?.scoringUpdatedAt && profile.scoringUpdatedAt > report.updatedAt
          ? "needs_reanalysis" as const
          : "current" as const,
      }] : [];
    });

  res.json(
    GetDashboardSummaryResponse.parse({
      totalPostings,
      appliedPostings,
      archivedPostings,
      avgFitScore,
      topMatches,
      strongMatches,
      hasProfile: !!profile,
      gmailConnected: !!gmailConn,
    }),
  );
});

export default router;
