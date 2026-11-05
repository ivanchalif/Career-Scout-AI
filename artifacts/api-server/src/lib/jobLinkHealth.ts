import { and, eq, isNull } from "drizzle-orm";
import { db, jobPostingsTable } from "@workspace/db";
import { fetchJobPageContent, type PageResult } from "./pageScraper";
import { logger } from "./logger";

/** Only an actual HTTP 404 is conclusive for this automatic closure rule. */
export function missingJobFields(page: PageResult | null) {
  if (page?.availability.reason !== "http_404") return {};
  return {
    closedAt: page.availability.checkedAt,
    availabilityStatus: "closed",
    availabilityCheckedAt: page.availability.checkedAt,
    availabilityReason: "http_404",
    availabilityConfidence: 1,
    availabilityEvidence: ["http_404"],
  };
}

type LinkPosting = Pick<typeof jobPostingsTable.$inferSelect,
  "id" | "userId" | "link" | "closedAt" | "deletedAt" | "availabilityCheckedAt">;
const pending = new Set<string>();
const queue: LinkPosting[] = [];
let running = 0;
const MAX_PENDING = 200;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Safe scraper checks are bounded and never delay the dashboard HTTP response. */
export function scheduleJobLinkChecks(postings: LinkPosting[]): void {
  for (const posting of postings) {
    const key = `${posting.userId}:${posting.id}`;
    if (!posting.link || posting.closedAt || posting.deletedAt || pending.has(key)) continue;
    if (posting.availabilityCheckedAt && Date.now() - posting.availabilityCheckedAt.getTime() < CHECK_INTERVAL_MS) continue;
    if (pending.size >= MAX_PENDING) break;
    pending.add(key);
    queue.push(posting);
  }
  drain();
}

function drain(): void {
  while (running < 3 && queue.length) {
    const posting = queue.shift()!;
    running++;
    void checkJobLink(posting).catch((err) => {
      logger.warn({ postingId: posting.id, err }, "job link health check failed");
    }).finally(() => {
      pending.delete(`${posting.userId}:${posting.id}`);
      running--;
      drain();
    });
  }
}

export async function checkJobLink(posting: LinkPosting): Promise<void> {
  if (!posting.link || posting.closedAt || posting.deletedAt) return;
  const page = await fetchJobPageContent(posting.link);
  if (!page) return;
  await db.update(jobPostingsTable).set({
    availabilityStatus: page.availability.status,
    availabilityCheckedAt: page.availability.checkedAt,
    availabilityReason: page.availability.reason,
    availabilityConfidence: page.availability.confidence,
    availabilityEvidence: page.availability.evidence,
    ...missingJobFields(page),
  }).where(and(
    eq(jobPostingsTable.id, posting.id),
    eq(jobPostingsTable.userId, posting.userId),
    eq(jobPostingsTable.link, posting.link),
    isNull(jobPostingsTable.closedAt),
    isNull(jobPostingsTable.deletedAt),
  ));
}
