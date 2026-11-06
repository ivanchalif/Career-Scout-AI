import { and, eq, inArray, isNotNull, isNull, or, ilike, asc, desc, sql } from "drizzle-orm";
import { db, jobPostingsTable as p, matchReportsTable as r, jobPostingFeedbackTable as f, scoringJobsTable as j, userProfilesTable, onlineDiscoverySourcesTable } from "@workspace/db";
import { postingFilterReason } from "./postingFilters";
import { rankCandidate, buildDiscoveryCriteria } from "./onlineDiscovery";
import { scheduleJobLinkChecks, isConfirmedClosedAvailability } from "./jobLinkHealth";

export const POSTING_SORTS = ["recommended", "date-desc", "date-asc", "score-desc", "score-asc", "title-asc", "title-desc", "company-asc", "company-desc"] as const;
export type PostingListOptions = {
  search?: string; minFitScore?: number; source?: string; applied?: boolean; hidden?: boolean;
  archived?: boolean; limit?: number; offset?: number; sort?: string; compact?: boolean;
};

/** Small visibility projection first, full records only for the requested page.
 * Complex location policy stays shared in JS to preserve unknown-location rules.
 * Search, lifecycle, minimum score and ordering are handled by PostgreSQL.
 */
export async function listPostingPage(userId: string, options: PostingListOptions) {
  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  const conditions = [eq(p.userId, userId)];
  if (options.archived) conditions.push(or(isNotNull(p.deletedAt), isNotNull(p.closedAt))!);
  else conditions.push(isNull(p.deletedAt), isNull(p.closedAt));
  if (options.applied === true) conditions.push(isNotNull(p.appliedAt));
  if (options.applied === false) conditions.push(isNull(p.appliedAt));
  if (options.source) conditions.push(eq(p.source, options.source));
  if (options.search) {
    const literal = options.search.replace(/[\\%_]/g, "\\$&");
    conditions.push(or(ilike(p.title, `%${literal}%`), ilike(p.company, `%${literal}%`))!);
  }
  if (options.minFitScore != null) conditions.push(sql`${r.fitScore} >= ${options.minFitScore}`);
  const score = sql`coalesce(${r.fitScore}, -1)`;
  const order = {
    recommended: desc(sql`coalesce(${r.fitScore}, 0) + ${p.preferenceAdjustment}`),
    "date-desc": desc(p.createdAt), "date-asc": asc(p.createdAt),
    "score-desc": desc(score), "score-asc": asc(sql`coalesce(${r.fitScore}, 101)`),
    "title-asc": asc(p.title), "title-desc": desc(p.title),
    "company-asc": asc(p.company), "company-desc": desc(p.company),
  }[options.sort ?? "score-desc"] ?? desc(score);
  const candidates = await db.select({
    id: p.id, title: p.title, company: p.company, location: p.location, link: p.link, remoteType: p.remoteType,
    availabilityCheckedAt: p.availabilityCheckedAt,
    availabilityStatus: p.availabilityStatus, availabilityReason: p.availabilityReason, availabilityConfidence: p.availabilityConfidence,
  }).from(p).leftJoin(r, and(eq(r.jobPostingId, p.id), eq(r.userId, userId)))
    .where(and(...conditions)).orderBy(order, desc(p.createdAt), desc(p.id));
  const confirmedClosed = options.archived ? [] : candidates.filter((candidate) => isConfirmedClosedAvailability({
    status: candidate.availabilityStatus, reason: candidate.availabilityReason, confidence: candidate.availabilityConfidence,
  }));
  if (confirmedClosed.length) {
    await db.update(p).set({ closedAt: new Date(), availabilityStatus: "closed" })
      .where(and(eq(p.userId, userId), inArray(p.id, confirmedClosed.map((candidate) => candidate.id)), isNull(p.closedAt)));
  }
  const visible = candidates.filter((candidate) => !confirmedClosed.some((closed) => closed.id === candidate.id));
  const eligible = options.archived ? visible : visible.filter((posting) =>
    options.hidden ? !!postingFilterReason(posting, profile) : !postingFilterReason(posting, profile));
  if (!options.archived && !options.hidden) {
    scheduleJobLinkChecks(visible.map((posting) => ({
      id: posting.id, userId, link: posting.link, closedAt: null, deletedAt: null,
      availabilityCheckedAt: posting.availabilityCheckedAt,
    })));
  }
  const ids = eligible.slice(options.offset ?? 0, options.limit ? (options.offset ?? 0) + options.limit : undefined).map((posting) => posting.id);
  if (!ids.length) return [];
  const rows = await db.select({ posting: p, report: r, feedback: { kind: f.kind, createdAt: f.createdAt }, scoring: { status: j.status, attempts: j.attempts } })
    .from(p).leftJoin(r, and(eq(r.jobPostingId, p.id), eq(r.userId, userId)))
    .leftJoin(f, and(eq(f.jobPostingId, p.id), eq(f.userId, userId)))
    .leftJoin(j, and(eq(j.postingId, p.id), eq(j.userId, userId)))
    .where(and(eq(p.userId, userId), inArray(p.id, ids)));
  const sources = await db.select().from(onlineDiscoverySourcesTable).where(eq(onlineDiscoverySourcesTable.userId, userId));
  const byId = new Map(rows.map((row) => [row.posting.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const { posting, report, feedback, scoring } = row;
    const sourceName = sources.find((source) => posting.source === `${source.provider}:${source.id}` || posting.source === source.provider)?.name ?? null;
    const scoreStatus = report?.fitScore == null ? "pending"
      : profile && profile.scoringUpdatedAt > report.updatedAt ? "needs_reanalysis" : "current";
    const online = /^(?:arbeitnow|brave|google|hiringcafe|custom)(?::\d+)?$/.test(posting.source);
    const onlineMatchScore = profile && online ? rankCandidate({
      provider: posting.source, sourceJobId: null, title: posting.title, company: posting.company,
      description: posting.fullDescription, url: posting.link ?? "", location: posting.location,
      remote: posting.remoteType === "remote", tags: posting.extractedSkills, postedAt: posting.sourcePostedAt,
    }, buildDiscoveryCriteria(profile), profile) : null;
    return [{
      posting: options.compact ? { ...posting, fullDescription: "", requiredSkills: [], niceToHaveSkills: [], availabilityEvidence: [], fieldEvidence: {} } : posting,
      report: options.compact && report ? { ...report, reasoning: null, missingSkills: [], matchedSkills: report.matchedSkills.slice(0, 4) } : report,
      feedback: feedback?.kind ? feedback : null, sourceName, onlineMatchScore, scoreStatus,
      analysisState: scoring?.status ?? (report?.fitScore == null ? "queued" : "completed"),
      ...(options.hidden ? { filterReason: postingFilterReason(posting, profile) } : {}),
    }];
  });
}
