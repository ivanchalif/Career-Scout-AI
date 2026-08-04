import { eq, and, isNotNull } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable, userProfilesTable, gmailSeenKeysTable, filteredEmailsTable, emailSyncLogTable, syncEventsTable } from "@workspace/db";
import type { EmailSyncOutcome } from "@workspace/db";
import { fetchJobEmails, markEmailAsRead, estimateEmailCount, DEFAULT_EMAIL_FILTER_CRITERIA } from "./gmailClient";
import { extractJobListings } from "./scoringService";
import { scorePostingBackground, sweepUnscoredPostings } from "./scoringService";
import { isFuzzyDuplicate, runDedupSweep } from "./dedup";
import { fetchJobPageContent } from "./pageScraper";
import { logger } from "./logger";

/** Extracts the display name from a raw "From" header value. */
function parseSenderName(sender: string): string {
  const match = sender.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  if (match) return match[1].trim();
  return sender.trim();
}

const CHECK_INTERVAL_MS = 1 * 60 * 1000; // check every 1 minute
const DEFAULT_SYNC_HOURS = 1; // used when user has Gmail connected but no schedule set

// Sender domains that never send job postings — used to short-circuit processing
// before spending any LLM tokens. Add more as they appear.
const BLOCKED_SENDER_DOMAINS = new Set([
  "ebay.com", "ebay.co.uk", "ebay.de", "ebay.fr", "ebay.it", "ebay.es",
  "amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr",
  "paypal.com",
  "etsy.com",
  "craigslist.org",
  "facebook.com", "meta.com",
  "instagram.com",
  "twitter.com", "x.com",
  "tiktok.com",
  "netflix.com",
  "spotify.com",
  "apple.com",
  "google.com", "googleadservices.com",
  "noreply.github.com",
  "notifications.google.com",
  "donotreply.com",
]);

function isBlockedSender(senderEmail: string): boolean {
  const domainMatch = senderEmail.match(/@([\w.-]+)/);
  if (!domainMatch) return false;
  const domain = domainMatch[1].toLowerCase();
  // Check exact domain and parent domain (e.g. "marketing.ebay.com" → "ebay.com")
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (BLOCKED_SENDER_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}


function extractSender(from: string): string {
  const match = from.match(/^(?:"?([^"<]+)"?\s*)?<?.+>?$/);
  const name = match?.[1]?.trim();
  if (name && name.length > 0 && name.length <= 100) return name;
  const domainMatch = from.match(/@([^>@\s]+)/);
  return domainMatch?.[1] ?? from.slice(0, 100);
}

function extractSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return from.trim().toLowerCase();
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

export interface SyncUserResult {
  synced: number;
  lastSyncedAt: Date;
}

/** Per-user lock: prevents concurrent syncUser calls for the same userId. */
const activeSyncs = new Set<string>();

/**
 * Sync a single user's Gmail inbox.
 * @param conn             The user's Gmail connection row.
 * @param emailsPreFilter  Pre-computed estimate of matching emails before fetch
 *                         (pass 0 when calling from the scheduler).
 */
export async function syncUser(
  conn: typeof gmailConnectionsTable.$inferSelect,
  emailsPreFilter = 0,
): Promise<SyncUserResult> {
  // Guard: skip if a sync is already in progress for this user.
  if (activeSyncs.has(conn.userId)) {
    logger.warn({ userId: conn.userId }, "gmailScheduler: sync already in progress for user — skipping concurrent call");
    const lastSyncedAt = conn.lastSyncedAt ? new Date(conn.lastSyncedAt) : new Date();
    return { synced: 0, lastSyncedAt };
  }
  activeSyncs.add(conn.userId);

  try {
    return await _syncUserInner(conn, emailsPreFilter);
  } finally {
    activeSyncs.delete(conn.userId);
  }
}

async function _syncUserInner(
  conn: typeof gmailConnectionsTable.$inferSelect,
  emailsPreFilter: number,
): Promise<SyncUserResult> {
  const [userProfile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, conn.userId));
  const filterCriteria = userProfile?.emailFilterSettings ?? DEFAULT_EMAIL_FILTER_CRITERIA;

  let emails: Awaited<ReturnType<typeof fetchJobEmails>>;
  try {
    emails = await fetchJobEmails(conn.accessToken, conn.refreshToken, filterCriteria);
  } catch (err) {
    if ((err as Error)?.message?.includes("invalid_grant")) {
      logger.warn({ userId: conn.userId }, "gmailScheduler: invalid_grant — removing stale connection");
      await db.delete(gmailConnectionsTable).where(eq(gmailConnectionsTable.userId, conn.userId));
      return { synced: 0, lastSyncedAt: new Date() };
    }
    throw err;
  }

  const seenKeys = await db
    .select({ gmailKey: gmailSeenKeysTable.gmailKey })
    .from(gmailSeenKeysTable)
    .where(eq(gmailSeenKeysTable.userId, conn.userId));

  const processedBaseIds = new Set(seenKeys.map((r) => r.gmailKey.split(":")[0]));
  // Also deduplicate within the fetched batch itself (Gmail API can return the
  // same message ID twice when a message matches multiple query conditions).
  const seenInBatch = new Set<string>();
  const newEmails = emails.filter((e) => {
    if (processedBaseIds.has(e.messageId) || seenInBatch.has(e.messageId)) return false;
    seenInBatch.add(e.messageId);
    return true;
  });

  let synced = 0;
  let jobsExtracted = 0;
  let jobsSkippedDedup = 0;
  let jobsSkippedActiveDup = 0;
  let jobsSkippedUserDeleted = 0;
  let jobsSkippedApplied = 0;

  for (const email of newEmails) {
    if (!email.body.trim()) continue;

    const _emailMeta = {
      userId: conn.userId,
      gmailMessageId: email.messageId,
      subject: email.subject ?? "",
      senderEmail: extractSenderEmail(email.sender),
      senderName: parseSenderName(email.sender) || null,
    };

    if (isBlockedSender(email.sender)) {
      logger.info({ messageId: email.messageId, sender: email.sender }, "gmailScheduler: skipping email from blocked sender domain");
      // Mark seen so we don't re-process it on every cycle
      await db.insert(gmailSeenKeysTable).values({ userId: conn.userId, gmailKey: `${email.messageId}:blocked` }).onConflictDoNothing();
      await db.insert(filteredEmailsTable).values({ ..._emailMeta, reason: "blocked_sender" }).onConflictDoNothing();
      await db.insert(emailSyncLogTable).values({ ..._emailMeta, outcome: "skipped_blocked_sender" });
      continue;
    }

    if (isApplicationResponseEmail(email.subject, email.body)) {
      logger.info({ messageId: email.messageId, subject: email.subject }, "gmailScheduler: skipping application response email");
      // Mark seen so we don't re-process it on every sync cycle
      await db.insert(gmailSeenKeysTable).values({ userId: conn.userId, gmailKey: `${email.messageId}:appresponse` }).onConflictDoNothing();
      await db.insert(filteredEmailsTable).values({ ..._emailMeta, reason: "application_response" }).onConflictDoNothing();
      await db.insert(emailSyncLogTable).values({ ..._emailMeta, outcome: "skipped_application_response" });
      continue;
    }

    const { listings, hadError } = await extractJobListings(email.body, email.subject, email.sender);
    jobsExtracted += listings.length;

    const blockedKeywords = filterCriteria.blockedBodyKeywords ?? [];
    let emailImported = 0;
    let emailSkipped = 0;
    const emailSkipReasons = new Set<string>();

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (!listing.description.trim()) { emailSkipped++; continue; }

      // Enrich description by fetching the actual job posting page when a URL
      // is available. Fall back to the email excerpt if the fetch fails.
      // Also capture the final URL after redirects (resolves tracking links
      // like Jobgether's click-through URLs to the actual job page).
      let description = listing.description;
      let descriptionSource: "page" | "email" = "email";
      let resolvedUrl = listing.url;

      if (listing.url) {
        const pageResult = await fetchJobPageContent(listing.url);
        if (pageResult) {
          // Always use finalUrl — captures the real job URL after following tracking redirects.
          resolvedUrl = pageResult.finalUrl;
          if (pageResult.contentUsable) {
            description = pageResult.content;
            descriptionSource = "page";
            logger.info(
              { url: listing.url, finalUrl: pageResult.finalUrl, chars: pageResult.content.length },
              "gmailScheduler: enriched description from job page",
            );
          } else {
            logger.info(
              { url: listing.url, finalUrl: pageResult.finalUrl },
              "gmailScheduler: page content unusable, stored finalUrl, using email excerpt",
            );
          }
        } else {
          logger.info(
            { url: listing.url },
            "gmailScheduler: page fetch failed (network/timeout), using email excerpt",
          );
        }
      }

      // Apply blocked keyword filter against whichever description we ended up with
      if (blockedKeywords.length > 0) {
        const descLower = description.toLowerCase();
        const hit = blockedKeywords.find((kw) => descLower.includes(kw.toLowerCase()));
        if (hit) {
          logger.info(
            { messageId: email.messageId, title: listing.title, blockedKeyword: hit, descriptionSource },
            "gmailScheduler: skipping individual listing — description contains blocked keyword",
          );
          await db.insert(filteredEmailsTable).values({
            ..._emailMeta,
            reason: "body_keyword",
            blockedKeyword: hit,
            listingTitle: listing.title || null,
            listingCompany: listing.company || null,
          });
          emailSkipped++;
          emailSkipReasons.add("body_keyword");
          continue;
        }
      }

      const gmailKey = `${email.messageId}:${i}`;
      const title = listing.title || email.subject.slice(0, 200) || "Job Opportunity";
      const company = listing.company || extractSender(email.sender);

      await db
        .insert(gmailSeenKeysTable)
        .values({ userId: conn.userId, gmailKey })
        .onConflictDoNothing();

      const { isDuplicate, matchedTitle, matchedCompany, wasDeleted, wasApplied } = await isFuzzyDuplicate(conn.userId, title, company);
      if (isDuplicate) {
        logger.info(
          { userId: conn.userId, title, company, matchedTitle, matchedCompany, wasDeleted, wasApplied },
          wasDeleted
            ? "gmailScheduler: skipping posting previously dismissed by user"
            : wasApplied
            ? "gmailScheduler: skipping posting already applied to"
            : "gmailScheduler: skipping fuzzy duplicate posting",
        );
        const dupReason = wasDeleted ? "duplicate_dismissed" : wasApplied ? "duplicate_applied" : "duplicate";
        await db.insert(filteredEmailsTable).values({
          ..._emailMeta,
          reason: dupReason,
          listingTitle: title,
          listingCompany: company,
        });
        emailSkipped++;
        emailSkipReasons.add(dupReason);
        jobsSkippedDedup++;
        if (wasDeleted) jobsSkippedUserDeleted++;
        else if (wasApplied) jobsSkippedApplied++;
        else jobsSkippedActiveDup++;
        continue;
      }

      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId: conn.userId,
          title,
          company,
          fullDescription: description.slice(0, 10_000),
          link: resolvedUrl ?? null,
          source: "gmail",
          senderName: parseSenderName(email.sender),
          gmailMessageId: gmailKey,
          extractedSkills: [],
        })
        .onConflictDoNothing()
        .returning();

      if (newPosting) {
        scorePostingBackground(newPosting.id, conn.userId);
        emailImported++;
        synced++;
      }
    }

    // Write per-email sync log record
    const emailOutcome: EmailSyncOutcome = listings.length === 0
      ? "no_listings"
      : emailImported > 0 && emailSkipped === 0
      ? "imported"
      : emailImported > 0
      ? "partial"
      : "all_skipped";

    await db.insert(emailSyncLogTable).values({
      ..._emailMeta,
      outcome: emailOutcome,
      listingsExtracted: listings.length,
      listingsImported: emailImported,
      listingsSkipped: emailSkipped,
      skipReasons: [...emailSkipReasons],
      hadError,
    });

    // Only mark as read when extraction succeeded — if the LLM call errored,
    // leave the email unread so the next sync automatically retries it.
    if (!hadError) {
      await markEmailAsRead(conn.accessToken, conn.refreshToken, email.messageId);
      logger.debug({ messageId: email.messageId }, "gmailScheduler: marked email as read");
    } else {
      logger.warn({ messageId: email.messageId }, "gmailScheduler: extraction errored — leaving email unread for retry");
    }
  }

  const lastSyncedAt = new Date();
  await db
    .update(gmailConnectionsTable)
    .set({ lastSyncedAt, updatedAt: lastSyncedAt })
    .where(eq(gmailConnectionsTable.userId, conn.userId));

  await db.insert(syncEventsTable).values({
    userId: conn.userId,
    source: "gmail",
    emailsPreFilter,
    emailsFetched: emails.length,
    jobsExtracted,
    jobsImported: synced,
    jobsSkippedDedup,
    jobsSkippedActiveDup,
    jobsSkippedUserDeleted,
    jobsSkippedApplied,
  });

  sweepUnscoredPostings(conn.userId).catch((err) => {
    logger.warn({ userId: conn.userId, err }, "Gmail scheduler: sweep unscored postings failed");
  });

  runDedupSweep(conn.userId).then((removed) => {
    if (removed > 0) {
      logger.info({ userId: conn.userId, removed }, "Gmail scheduler: dedup sweep removed duplicate postings");
    }
  }).catch((err) => {
    logger.warn({ userId: conn.userId, err }, "Gmail scheduler: dedup sweep failed");
  });

  return { synced, lastSyncedAt };
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

      // If the user has never set a schedule, fall back to DEFAULT_SYNC_HOURS
      // rather than silently skipping them forever.
      const scheduleHours = profile?.syncScheduleHours ?? DEFAULT_SYNC_HOURS;

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

      const { synced } = await syncUser(conn);
      logger.info({ userId: conn.userId, synced }, "Gmail scheduler: scheduled sync complete");
    } catch (err) {
      logger.error({ userId: conn.userId, err }, "Gmail scheduler: failed to sync user");
    }
  }
}

export function startGmailScheduler(): void {
  const checkIntervalMinutes = CHECK_INTERVAL_MS / 60_000;
  logger.info(
    { checkIntervalMinutes, defaultSyncHours: DEFAULT_SYNC_HOURS },
    "Gmail scheduler: starting",
  );

  // Run immediately on startup so the first sync is not delayed by the full
  // interval — important because every server restart would otherwise reset the
  // 5-minute (or longer) countdown.
  checkAndSyncUsers().catch((err) => {
    logger.error({ err }, "Gmail scheduler: unhandled error in startup check");
  });

  setInterval(() => {
    checkAndSyncUsers().catch((err) => {
      logger.error({ err }, "Gmail scheduler: unhandled error in check cycle");
    });
  }, CHECK_INTERVAL_MS);
}
