import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, userProfilesTable, syncEventsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/filter-stats", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const safeId = userId.replace(/[^a-zA-Z0-9_]/g, "");

  const [profile] = await db
    .select({
      companyFilterSettings: userProfilesTable.companyFilterSettings,
      titleExcludeKeywords: userProfilesTable.titleExcludeKeywords,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));

  const companyFilter = (profile?.companyFilterSettings as {
    mode: "off" | "include" | "exclude";
    companies: string[];
  } | null) ?? { mode: "off" as const, companies: [] };

  const titleKeywords: string[] = (profile?.titleExcludeKeywords as string[] | null) ?? [];

  // Build SQL fragments for filters (mirrors frontend filter logic)
  const buildCompanyMatchSql = (companies: string[]): string => {
    if (companies.length === 0) return "FALSE";
    const escaped = companies.map((c) =>
      `'${c.toLowerCase().replace(/'/g, "''")}'`
    );
    return `lower(company) = ANY(ARRAY[${escaped.join(",")}])`;
  };

  const buildTitleMatchSql = (keywords: string[]): string => {
    if (keywords.length === 0) return "FALSE";
    return keywords
      .map((kw) => `lower(title) LIKE '%${kw.toLowerCase().replace(/'/g, "''")}%'`)
      .join(" OR ");
  };

  const companyMatchSql = buildCompanyMatchSql(companyFilter.companies);
  const titleMatchSql = buildTitleMatchSql(titleKeywords);

  const hiddenByCompanySql =
    companyFilter.mode === "exclude"
      ? companyMatchSql
      : companyFilter.mode === "include" && companyFilter.companies.length > 0
      ? `NOT (${companyMatchSql})`
      : "FALSE";

  const hiddenByEitherSql =
    hiddenByCompanySql === "FALSE" && titleMatchSql === "FALSE"
      ? "FALSE"
      : hiddenByCompanySql === "FALSE"
      ? titleMatchSql
      : titleMatchSql === "FALSE"
      ? hiddenByCompanySql
      : `(${hiddenByCompanySql}) OR (${titleMatchSql})`;

  const statsResult = await db.execute(sql.raw(`
    SELECT
      COUNT(*)                                          AS raw_active,
      COUNT(*) FILTER (WHERE ${hiddenByCompanySql})     AS hidden_by_company,
      COUNT(*) FILTER (WHERE ${titleMatchSql})          AS hidden_by_title,
      COUNT(*) FILTER (WHERE ${hiddenByEitherSql})      AS hidden_total
    FROM job_postings
    WHERE user_id = '${safeId}'
      AND deleted_at IS NULL AND closed_at IS NULL AND applied_at IS NULL
  `));

  const row = statsResult.rows[0] as Record<string, unknown>;
  const rawActive       = Number(row.raw_active ?? 0);
  const hiddenByCompany = Number(row.hidden_by_company ?? 0);
  const hiddenByTitle   = Number(row.hidden_by_title ?? 0);
  const hiddenTotal     = Number(row.hidden_total ?? 0);

  // Recent sync events
  const syncHistory = await db
    .select()
    .from(syncEventsTable)
    .where(eq(syncEventsTable.userId, userId))
    .orderBy(desc(syncEventsTable.syncedAt))
    .limit(20);

  const totals = syncHistory.reduce(
    (acc, e) => ({
      totalEmailsPreFilter:      acc.totalEmailsPreFilter      + (e.emailsPreFilter       ?? 0),
      totalEmailsFetched:        acc.totalEmailsFetched        + e.emailsFetched,
      totalJobsExtracted:        acc.totalJobsExtracted        + e.jobsExtracted,
      totalJobsImported:         acc.totalJobsImported         + e.jobsImported,
      totalJobsSkippedDedup:     acc.totalJobsSkippedDedup     + e.jobsSkippedDedup,
      totalSkippedActiveDup:     acc.totalSkippedActiveDup     + (e.jobsSkippedActiveDup  ?? 0),
      totalSkippedUserDeleted:   acc.totalSkippedUserDeleted   + (e.jobsSkippedUserDeleted ?? 0),
      totalSkippedApplied:       acc.totalSkippedApplied       + (e.jobsSkippedApplied    ?? 0),
    }),
    {
      totalEmailsPreFilter: 0, totalEmailsFetched: 0, totalJobsExtracted: 0,
      totalJobsImported: 0, totalJobsSkippedDedup: 0, totalSkippedActiveDup: 0,
      totalSkippedUserDeleted: 0, totalSkippedApplied: 0,
    },
  );

  res.json({
    profileFilters: {
      rawActive,
      shownOnDashboard: rawActive - hiddenTotal,
      hiddenByCompany,
      hiddenByTitleKeywords: hiddenByTitle,
      companyFilterMode: companyFilter.mode,
      companyFilterCount: companyFilter.companies.length,
      titleKeywordCount: titleKeywords.length,
    },
    syncHistory: syncHistory.map((e) => ({
      id: e.id,
      source: e.source,
      syncedAt: e.syncedAt.toISOString(),
      emailsPreFilter:        e.emailsPreFilter       ?? 0,
      emailsFetched:          e.emailsFetched,
      jobsExtracted:          e.jobsExtracted,
      jobsImported:           e.jobsImported,
      jobsSkippedDedup:       e.jobsSkippedDedup,
      jobsSkippedActiveDup:   e.jobsSkippedActiveDup  ?? 0,
      jobsSkippedUserDeleted: e.jobsSkippedUserDeleted ?? 0,
      jobsSkippedApplied:     e.jobsSkippedApplied    ?? 0,
    })),
    totalSyncs: syncHistory.length,
    ...totals,
  });
});

export default router;
