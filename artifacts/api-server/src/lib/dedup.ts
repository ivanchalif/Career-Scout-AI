import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, jobPostingsTable, jobDuplicateExceptionsTable } from "@workspace/db";
import { compareJobs, normalizeTitle, pairKey, type DuplicateCandidate } from "./duplicatePolicy";
import { historicalDuplicateMatches } from "./duplicateVisibility";
export { canonicalizeJobUrl } from "./duplicatePolicy";
/** Compatibility for discovery retrieval keys; not an automatic duplicate test. */
export const normalizeFuzzy = normalizeTitle;

export type DuplicatePosting = typeof jobPostingsTable.$inferSelect;

export async function loadDuplicateExceptions(userId: string): Promise<Set<string>> {
  const rows = await db.select().from(jobDuplicateExceptionsTable).where(eq(jobDuplicateExceptionsTable.userId, userId));
  return new Set(rows.map((row) => pairKey(row.postingIdLow, row.postingIdHigh)));
}

export async function loadHistoricalDuplicateMatches(userId: string) {
  const [postings, exceptions] = await Promise.all([
    db.select({
      id: jobPostingsTable.id, title: jobPostingsTable.title, company: jobPostingsTable.company,
      link: jobPostingsTable.link, appliedAt: jobPostingsTable.appliedAt,
      location: jobPostingsTable.location, fullDescription: jobPostingsTable.fullDescription,
      jobIdentity: jobPostingsTable.jobIdentity,
      deletedAt: jobPostingsTable.deletedAt, closedAt: jobPostingsTable.closedAt,
    }).from(jobPostingsTable).where(eq(jobPostingsTable.userId, userId)),
    loadDuplicateExceptions(userId),
  ]);
  return historicalDuplicateMatches(postings, exceptions);
}

/** Similarity never blocks imports; exact title/company or listing identity can. */
export async function isFuzzyDuplicate(
  userId: string, title: string, company: string,
  options?: { excludeId?: number; deletedOrAppliedOnly?: boolean; link?: string | null; jobIdentity?: DuplicateCandidate["jobIdentity"]; location?: string | null; fullDescription?: string | null },
): Promise<{ isDuplicate: boolean; matchedTitle?: string; matchedCompany?: string; matchedId?: number; wasDeleted?: boolean; wasApplied?: boolean }> {
  const postings = await db.select().from(jobPostingsTable).where(eq(jobPostingsTable.userId, userId));
  const exceptions = options?.excludeId ? await loadDuplicateExceptions(userId) : new Set<string>();
  const candidate: DuplicateCandidate = { title, company, link: options?.link, jobIdentity: options?.jobIdentity,
    location: options?.location, fullDescription: options?.fullDescription };
  const match = postings.find((posting) => posting.id !== options?.excludeId
    && (!options?.deletedOrAppliedOnly || posting.deletedAt || posting.appliedAt)
    && (!options?.excludeId || !exceptions.has(pairKey(options.excludeId, posting.id)))
    && compareJobs(candidate, posting).kind === "duplicate");
  return match ? {
    isDuplicate: true, matchedId: match.id, matchedTitle: match.title, matchedCompany: match.company,
    wasDeleted: Boolean(match.deletedAt), wasApplied: Boolean(match.appliedAt),
  } : { isDuplicate: false };
}

export async function previewConfirmedDuplicates(userId: string, anchorId?: number): Promise<number[]> {
  const postings = await db.select().from(jobPostingsTable).where(eq(jobPostingsTable.userId, userId));
  const exceptions = await loadDuplicateExceptions(userId);
  const anchors = anchorId == null
    ? postings.filter((p) => p.deletedAt || p.appliedAt)
    : postings.filter((p) => p.id === anchorId);
  const ids = postings.filter((p) => !p.deletedAt && !p.closedAt && !p.appliedAt && !p.dismissalUndoToken
    && anchors.some((anchor) => anchor.id !== p.id
      && !exceptions.has(pairKey(anchor.id, p.id))
      && compareJobs(p, anchor).kind === "duplicate")).map((p) => p.id);
  return ids;
}

async function removeConfirmedDuplicates(userId: string, anchorId?: number, allowedIds?: number[]): Promise<number> {
  const ids = (await previewConfirmedDuplicates(userId, anchorId)).filter((id) => !allowedIds || allowedIds.includes(id));
  if (!ids.length) return 0;
  const removed = await db.update(jobPostingsTable).set({ deletedAt: new Date(), deletedBy: "sweep" })
    .where(and(eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, ids),
      isNull(jobPostingsTable.deletedAt), isNull(jobPostingsTable.closedAt),
      isNull(jobPostingsTable.appliedAt), isNull(jobPostingsTable.dismissalUndoToken)))
    .returning({ id: jobPostingsTable.id });
  return removed.length;
}

export async function runDedupSweep(userId: string, selectedIds?: number[]): Promise<number> {
  return removeConfirmedDuplicates(userId, undefined, selectedIds);
}
export async function sweepDuplicatesOf(userId: string, _title: string, _company: string, excludeId: number): Promise<number> {
  return removeConfirmedDuplicates(userId, excludeId);
}

/** Legacy callers may import this normalizer; never use it as identity proof. */
export function dbNormalizeSql(col: string): string {
  return `btrim(regexp_replace(lower(${col}), '[^a-z0-9 ]', ' ', 'g'))`;
}
