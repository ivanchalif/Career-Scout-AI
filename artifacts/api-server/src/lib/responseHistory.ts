import { and, eq, isNotNull, or, sql, desc } from "drizzle-orm";
import { db, jobPostingsTable, jobPostingFeedbackTable } from "@workspace/db";
import type { ResponseExample } from "./responseLearning";

/** Read current actions, not cumulative counters, so Undo/unapply takes effect. */
export async function loadResponseHistory(userId: string): Promise<ResponseExample[]> {
  const actionAt = sql<Date>`greatest(${jobPostingFeedbackTable.createdAt}, ${jobPostingsTable.appliedAt}, ${jobPostingsTable.deletedAt}, ${jobPostingsTable.closedAt}, ${jobPostingsTable.createdAt})`;
  const rows = await db.select({
    title: jobPostingsTable.title,
    company: jobPostingsTable.company,
    location: jobPostingsTable.location,
    link: jobPostingsTable.link,
    skills: jobPostingsTable.extractedSkills,
    appliedAt: jobPostingsTable.appliedAt,
    deletedAt: jobPostingsTable.deletedAt,
    deletedBy: jobPostingsTable.deletedBy,
    closedAt: jobPostingsTable.closedAt,
    feedbackKind: jobPostingFeedbackTable.kind,
    feedbackAt: jobPostingFeedbackTable.createdAt,
    actionAt,
  }).from(jobPostingsTable).leftJoin(jobPostingFeedbackTable, and(
    eq(jobPostingFeedbackTable.jobPostingId, jobPostingsTable.id),
    eq(jobPostingFeedbackTable.userId, userId),
  )).where(and(
    eq(jobPostingsTable.userId, userId),
    or(isNotNull(jobPostingsTable.appliedAt), isNotNull(jobPostingsTable.deletedAt),
      isNotNull(jobPostingsTable.closedAt), isNotNull(jobPostingFeedbackTable.kind)),
  )).orderBy(desc(actionAt)).limit(500);

  return rows.flatMap((row): ResponseExample[] => {
    if (row.deletedAt && row.deletedBy === "sweep") return [];
    const useFeedback = Boolean(row.feedbackKind && (!row.appliedAt
      || (row.feedbackAt && new Date(row.feedbackAt).getTime() >= new Date(row.appliedAt).getTime())));
    const kind = row.deletedAt && row.deletedBy === "duplicate" ? "duplicate"
      : row.closedAt ? "already_closed"
      : (useFeedback ? row.feedbackKind : null) ?? (row.appliedAt ? "applied"
        : row.closedAt ? "already_closed" : row.deletedAt ? "dismissed" : null);
    if (!kind) return [];
    // Do not double count an application and a like on the same job.
    return [{
      ...row,
      kind,
      at: useFeedback ? row.feedbackAt : row.appliedAt ?? row.closedAt ?? row.deletedAt,
      excludeExact: Boolean(row.appliedAt || row.deletedAt || row.closedAt),
    }];
  });
}
