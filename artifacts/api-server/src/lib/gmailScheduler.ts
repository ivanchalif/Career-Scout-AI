import { eq, and, isNotNull } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable, userProfilesTable, gmailSeenKeysTable } from "@workspace/db";
import { fetchJobEmails, markEmailAsRead } from "./gmailClient";
import { extractJobListings } from "./scoringService";
import { scorePostingBackground, sweepUnscoredPostings } from "./scoringService";
import { logger } from "./logger";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // check every 30 minutes

async function isFuzzyDuplicate(
  userId: string,
  title: string,
  company: string,
): Promise<{ isDuplicate: boolean; matchedTitle?: string; matchedCompany?: string }> {
  const { ilike, or } = await import("drizzle-orm");
  const existing = await db
    .select({ title: jobPostingsTable.title, company: jobPostingsTable.company })
    .from(jobPostingsTable)
    .where(
      and(
        eq(jobPostingsTable.userId, userId),
        or(
          ilike(jobPostingsTable.title, `%${title.slice(0, 40)}%`),
          ilike(jobPostingsTable.company, `%${company.slice(0, 40)}%`),
        ),
      ),
    );

  for (const row of existing) {
    const titleSim = titleSimilarity(row.title, title);
    const companySim = titleSimilarity(row.company, company);
    if (titleSim > 0.75 && companySim > 0.65) {
      return { isDuplicate: true, matchedTitle: row.title, matchedCompany: row.company };
    }
  }
  return { isDuplicate: false };
}

function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const wordsA = new Set(na.split(/\s+/).filter(Boolean));
  const wordsB = new Set(nb.split(/\s+/).filter(Boolean));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

function extractSender(from: string): string {
  const match = from.match(/^(?:"?([^"<]+)"?\s*)?<?.+>?$/);
  const name = match?.[1]?.trim();
  if (name && name.length > 0 && name.length <= 100) return name;
  const domainMatch = from.match(/@([^>@\s]+)/);
  return domainMatch?.[1] ?? from.slice(0, 100);
}

const APPLICATION_RESPONSE_PHRASES = [
  "after careful consideration",
  "unfortunately, we have decided",
  "we have decided not to move forward",
  "we've decided not to move forward",
  "we've decided to move forward with other candidates",
  "we have decided to move forward with other candidates",
  "we received many qualified applicants",
  "we really appreciate you for considering",
  "we appreciate your interest in",
  "we will not be moving forward",
  "not moving forward with your application",
  "we regret to inform you",
  "we are unable to offer you",
  "your application was not selected",
  "we have chosen to move forward with another candidate",
  "thank you for your application",
  "thank you for applying",
  "we have reviewed your application",
  "we received your application",
  "your application has been received",
  "application confirmation",
  "application received",
];

function isApplicationResponseEmail(subject: string, body: string): boolean {
  const combined = `${subject} ${body.slice(0, 3000)}`.toLowerCase();
  return APPLICATION_RESPONSE_PHRASES.some((phrase) => combined.includes(phrase));
}

async function syncUser(conn: typeof gmailConnectionsTable.$inferSelect): Promise<number> {
  const emails = await fetchJobEmails(conn.accessToken, conn.refreshToken);

  const seenKeys = await db
    .select({ gmailKey: gmailSeenKeysTable.gmailKey })
    .from(gmailSeenKeysTable)
    .where(eq(gmailSeenKeysTable.userId, conn.userId));

  const processedBaseIds = new Set(seenKeys.map((r) => r.gmailKey.split(":")[0]));
  const newEmails = emails.filter((e) => !processedBaseIds.has(e.messageId));
  let synced = 0;

  for (const email of newEmails) {
    if (!email.body.trim()) continue;

    if (isApplicationResponseEmail(email.subject, email.body)) {
      logger.info({ messageId: email.messageId, subject: email.subject }, "gmailScheduler: skipping application response email");
      continue;
    }

    const listings = await extractJobListings(email.body, email.subject, email.sender);

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (!listing.description.trim()) continue;

      const gmailKey = `${email.messageId}:${i}`;
      const title = listing.title || email.subject.slice(0, 200) || "Job Opportunity";
      const company = listing.company || extractSender(email.sender);

      await db
        .insert(gmailSeenKeysTable)
        .values({ userId: conn.userId, gmailKey })
        .onConflictDoNothing();

      const { isDuplicate } = await isFuzzyDuplicate(conn.userId, title, company);
      if (isDuplicate) continue;

      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId: conn.userId,
          title,
          company,
          fullDescription: listing.description.slice(0, 10_000),
          link: listing.url ?? null,
          source: "gmail",
          gmailMessageId: gmailKey,
          extractedSkills: [],
        })
        .onConflictDoNothing()
        .returning();

      if (newPosting) {
        scorePostingBackground(newPosting.id, conn.userId);
        synced++;
      }
    }

    // Mark the email as read in Gmail now that it has been fully processed
    await markEmailAsRead(conn.accessToken, conn.refreshToken, email.messageId);
    logger.debug({ messageId: email.messageId }, "gmailScheduler: marked email as read");
  }

  const lastSyncedAt = new Date();
  await db
    .update(gmailConnectionsTable)
    .set({ lastSyncedAt, updatedAt: lastSyncedAt })
    .where(eq(gmailConnectionsTable.userId, conn.userId));

  sweepUnscoredPostings(conn.userId).catch((err) => {
    logger.warn({ userId: conn.userId, err }, "Gmail scheduler: sweep unscored postings failed");
  });

  return synced;
}

async function checkAndSyncUsers(): Promise<void> {
  const connections = await db.select().from(gmailConnectionsTable);
  if (connections.length === 0) return;

  const now = Date.now();

  for (const conn of connections) {
    try {
      const [profile] = await db
        .select({ syncScheduleHours: userProfilesTable.syncScheduleHours })
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, conn.userId));

      const scheduleHours = profile?.syncScheduleHours ?? null;
      if (scheduleHours === null) {
        continue;
      }

      const lastSync = conn.lastSyncedAt ? new Date(conn.lastSyncedAt).getTime() : 0;
      const msSinceSync = now - lastSync;
      const msRequired = scheduleHours * 60 * 60 * 1000;

      if (msSinceSync < msRequired) {
        logger.debug(
          {
            userId: conn.userId,
            scheduleHours,
            msSinceSync: Math.round(msSinceSync / 60000),
          },
          "Gmail scheduler: not yet time for scheduled sync",
        );
        continue;
      }

      logger.info(
        { userId: conn.userId, scheduleHours },
        "Gmail scheduler: running scheduled sync for user",
      );

      const synced = await syncUser(conn);
      logger.info({ userId: conn.userId, synced }, "Gmail scheduler: scheduled sync complete");
    } catch (err) {
      logger.error({ userId: conn.userId, err }, "Gmail scheduler: failed to sync user");
    }
  }
}

export function startGmailScheduler(): void {
  logger.info(
    { checkIntervalMinutes: 30 },
    "Gmail scheduler: starting (checks every 30 min, respects per-user schedule)",
  );

  setInterval(() => {
    checkAndSyncUsers().catch((err) => {
      logger.error({ err }, "Gmail scheduler: unhandled error in check cycle");
    });
  }, CHECK_INTERVAL_MS);
}
