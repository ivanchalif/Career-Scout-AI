import { and, eq, inArray } from "drizzle-orm";
import { db, jobPostingsTable, jobPostingFeedbackTable } from "@workspace/db";
import { findDuplicateReviews } from "./duplicateReview";
import { loadDuplicateExceptions } from "./dedup";

/** Keep the account-wide identity index small. Arbitrary provider URLs and
 * verified original URLs must use the canonical policy, not lossy SQL guesses.
 * Only plausible, actually visited candidates retrieve description evidence.
 */
export async function loadDuplicateReviews(userId: string, postingIds?: Set<number>) {
  const postings = await db.select({
    id: jobPostingsTable.id, title: jobPostingsTable.title, company: jobPostingsTable.company,
    link: jobPostingsTable.link, location: jobPostingsTable.location,
    jobIdentity: jobPostingsTable.jobIdentity,
    appliedAt: jobPostingsTable.appliedAt, deletedAt: jobPostingsTable.deletedAt, closedAt: jobPostingsTable.closedAt,
    deletedBy: jobPostingsTable.deletedBy, dismissalReason: jobPostingFeedbackTable.kind,
    salaryMin: jobPostingsTable.salaryMin, salaryMax: jobPostingsTable.salaryMax,
    createdAt: jobPostingsTable.createdAt,
  }).from(jobPostingsTable).leftJoin(jobPostingFeedbackTable, and(
    eq(jobPostingFeedbackTable.jobPostingId, jobPostingsTable.id),
    eq(jobPostingFeedbackTable.userId, userId),
  )).where(eq(jobPostingsTable.userId, userId));
  const exceptions = await loadDuplicateExceptions(userId);
  return findDuplicateReviews(postings, exceptions, 40, postingIds, ids =>
    db.select({ id: jobPostingsTable.id, fullDescription: jobPostingsTable.fullDescription })
      .from(jobPostingsTable).where(and(
        eq(jobPostingsTable.userId, userId), inArray(jobPostingsTable.id, ids),
      )),
  );
}
