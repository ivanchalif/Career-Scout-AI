import { and, eq, sql } from "drizzle-orm";
import { db, scoringJobsTable } from "@workspace/db";
import { logger } from "./logger";
import { checkJobLink } from "./jobLinkHealth";

const MAX_ATTEMPTS = 4;
const LEASE_MS = 10 * 60_000;
let active = 0;
let started = false;

export function retryDelay(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

export async function enqueueScoring(postingId: number, userId: string, forceParse = false): Promise<void> {
  const now = new Date();
  await db.insert(scoringJobsTable).values({ userId, postingId, forceParse, requestedAt: now })
    .onConflictDoUpdate({
      target: [scoringJobsTable.userId, scoringJobsTable.postingId],
      set: {
        requestedAt: now,
        generation: sql`${scoringJobsTable.generation} + 1`,
        forceParse: sql`${scoringJobsTable.forceParse} or ${forceParse}`,
        // A running lease is never stolen. The worker notices the newer request.
        status: sql`case when ${scoringJobsTable.status} = 'running' then 'running' else 'queued' end`,
        attempts: sql`case when ${scoringJobsTable.status} = 'running' then ${scoringJobsTable.attempts} else 0 end`,
        runAfter: now,
      },
    });
  if (started) void drainScoringQueue();
}

/** Atomic leases survive restarts and prevent two processes claiming the same job. */
export async function drainScoringQueue(): Promise<void> {
  if (active >= 2) return;
  active++;
  try {
    const result = await db.execute(sql`
      with candidate as (
        select posting_id, user_id from scoring_jobs
        where (status = 'queued' and run_after <= now())
           or (status = 'running' and locked_until < now())
        order by attempts, requested_at
        for update skip locked limit 1
      )
      update scoring_jobs j set status = 'running', attempts = j.attempts + 1,
        locked_until = now() + (${LEASE_MS} * interval '1 millisecond')
      from candidate c where j.posting_id = c.posting_id and j.user_id = c.user_id
      returning j.*
    `);
    const job = result.rows[0] as {
      posting_id: number; user_id: string; attempts: number; force_parse: boolean; generation: number;
    } | undefined;
    if (!job) return;
    try {
      const { jobPostingsTable } = await import("@workspace/db");
      const [posting] = await db.select().from(jobPostingsTable)
        .where(and(eq(jobPostingsTable.id, job.posting_id), eq(jobPostingsTable.userId, job.user_id)));
      if (posting && !posting.deletedAt && !posting.closedAt) {
        if (posting.link && !posting.availabilityCheckedAt) await checkJobLink(posting);
        const [current] = await db.select({ closedAt: jobPostingsTable.closedAt, deletedAt: jobPostingsTable.deletedAt })
          .from(jobPostingsTable).where(and(eq(jobPostingsTable.id, job.posting_id), eq(jobPostingsTable.userId, job.user_id)));
        if (current && !current.closedAt && !current.deletedAt) {
          const { scorePosting } = await import("./scoringService");
          await scorePosting(job.posting_id, job.user_id, { forceParse: job.force_parse });
        }
      }
      await db.execute(sql`update scoring_jobs set
        status = case when generation > ${job.generation} then 'queued' else 'completed' end,
        attempts = case when generation > ${job.generation} then 0 else attempts end,
        locked_until = null, force_parse = case when generation > ${job.generation} then force_parse else false end
        where user_id = ${job.user_id} and posting_id = ${job.posting_id}`);
    } catch (err) {
      await db.execute(sql`update scoring_jobs set
        status = case when generation > ${job.generation} or attempts < ${MAX_ATTEMPTS} then 'queued' else 'failed' end,
        attempts = case when generation > ${job.generation} then 0 else attempts end,
        run_after = now() + (${retryDelay(job.attempts)} * interval '1 millisecond'), locked_until = null
        where user_id = ${job.user_id} and posting_id = ${job.posting_id}`);
      logger.warn({ postingId: job.posting_id, err }, "Scoring failed; durable retry state saved");
    }
  } catch (err) {
    logger.error({ err }, "Scoring worker could not claim or update work");
  } finally {
    active--;
  }
}

/** Recover imports interrupted between posting creation and queue insertion. */
export async function recoverUnscoredWork(): Promise<void> {
  await db.execute(sql`
    insert into scoring_jobs (user_id, posting_id)
    select p.user_id, p.id from job_postings p
    left join match_reports r on r.user_id = p.user_id and r.job_posting_id = p.id
    left join scoring_jobs j on j.user_id = p.user_id and j.posting_id = p.id
    where p.deleted_at is null and p.closed_at is null and r.fit_score is null and j.posting_id is null
    order by p.created_at limit 1000
    on conflict (user_id, posting_id) do nothing
  `);
}

export function startScoringWorker(): void {
  if (started) return;
  started = true;
  const tick = () => { void drainScoringQueue(); void drainScoringQueue(); };
  void recoverUnscoredWork().then(tick).catch((err) => logger.error({ err }, "Scoring recovery failed"));
  setInterval(tick, 2000).unref();
  setInterval(() => {
    void recoverUnscoredWork().catch((err) => logger.error({ err }, "Scoring recovery failed"));
  }, 60_000).unref();
}
