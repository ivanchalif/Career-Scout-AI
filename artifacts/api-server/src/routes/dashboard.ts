import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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

  const companyFilter = (profile?.companyFilterSettings as { mode: string; companies: string[] } | null) ?? { mode: "off", companies: [] };
  const titleExcludeKeywords: string[] = (profile?.titleExcludeKeywords as string[] | null) ?? [];

  const allPostings = await db
    .select()
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId));

  // Mirror the same filter chain the list endpoint uses
  const activeOnly = allPostings.filter((p) => {
    if (p.deletedAt) return false;
    if (p.closedAt) return false;
    if (p.appliedAt) return false;
    if (companyFilter.mode !== "off" && companyFilter.companies.length > 0) {
      const company = p.company.toLowerCase();
      const matches = companyFilter.companies.some((c: string) => {
        const entry = c.toLowerCase();
        return company.includes(entry) || entry.includes(company);
      });
      if (companyFilter.mode === "include" && !matches) return false;
      if (companyFilter.mode === "exclude" && matches) return false;
    }
    if (titleExcludeKeywords.length > 0) {
      const title = p.title.toLowerCase();
      if (titleExcludeKeywords.some((kw: string) => title.includes(kw.toLowerCase()))) return false;
    }
    return true;
  });

  // CONTRACT: every stat returned by this endpoint MUST be derived from `activeOnly`
  // (or a subset of it via `activeIds`). Never compute a stat from `allPostings` directly,
  // as that would silently bypass the company and title keyword filters from the user's profile.
  const totalPostings = activeOnly.length;
  const activeIds = new Set(activeOnly.map((p) => p.id));

  const reports = await db
    .select()
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
