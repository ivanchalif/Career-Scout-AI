import { and, eq, sql } from "drizzle-orm";
import { db, jobPostingsTable, jobPostingSourcesTable, type JobIdentityEvidence } from "@workspace/db";
import { canonicalizeJobUrl } from "./duplicatePolicy";

/** Preserve the observed provider URL, even when the posting link is redirected. */
export async function saveJobIdentitySource(input: {
  userId: string; postingId: number; provider: string; url: string;
  sourceJobId?: string | null; jobIdentity?: JobIdentityEvidence | null;
}): Promise<void> {
  const canonicalUrl = canonicalizeJobUrl(input.url);
  if (!canonicalUrl) return;
  await db.insert(jobPostingSourcesTable).values({
    userId: input.userId, jobPostingId: input.postingId, provider: input.provider,
    url: input.url, canonicalUrl, sourceJobId: input.sourceJobId,
    jobIdentity: input.jobIdentity, isPrimary: false,
  }).onConflictDoUpdate({
    target: [jobPostingSourcesTable.userId, jobPostingSourcesTable.canonicalUrl],
    // Do not reassign an existing source or erase earlier verified evidence
    // when a later request is blocked.
    set: {
      lastSeenAt: new Date(),
      ...(input.jobIdentity?.status === "verified" ? {
        jobIdentity: sql`CASE WHEN ${jobPostingSourcesTable.jobIdentity}->>'status' = 'verified'
          THEN ${jobPostingSourcesTable.jobIdentity} ELSE ${JSON.stringify(input.jobIdentity)}::jsonb END`,
      } : {}),
    },
    setWhere: eq(jobPostingSourcesTable.jobPostingId, input.postingId),
  });
  if (input.jobIdentity?.status === "verified") {
    await db.update(jobPostingsTable).set({ jobIdentity: input.jobIdentity })
      .where(and(eq(jobPostingsTable.userId, input.userId), eq(jobPostingsTable.id, input.postingId),
        sql`(${jobPostingsTable.jobIdentity} IS NULL OR ${jobPostingsTable.jobIdentity}->>'status' <> 'verified')`));
  }
}
