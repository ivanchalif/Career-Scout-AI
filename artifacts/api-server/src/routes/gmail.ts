import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable, gmailSeenKeysTable, userProfilesTable, syncEventsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getAuthUrl,
  exchangeCode,
  getGmailEmail,
  revokeTokens,
  fetchJobEmails,
  fetchSingleEmail,
  estimateEmailCount,
  markEmailAsRead,
  signState,
  verifyState,
} from "../lib/gmailClient";
import { scorePostingBackground, sweepUnscoredPostings, extractJobListings } from "../lib/scoringService";
import { isFuzzyDuplicate } from "../lib/dedup";
import { fetchJobPageContent } from "../lib/pageScraper";
import { logger } from "../lib/logger";

/** Extracts the display name from a raw "From" header value. */
function parseSenderName(sender: string): string {
  const match = sender.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  if (match) return match[1].trim();
  return sender.trim();
}

const router: IRouter = Router();

// Returns the Google OAuth URL as JSON — called via fetch so Clerk auth uses
// the Authorization header and never triggers a browser redirect loop.
router.get("/gmail/auth-url", requireAuth, (req: Request, res: Response): void => {
  const state = signState(req.userId);
  const url = getAuthUrl(state);
  const redirectUri = new URL(url).searchParams.get("redirect_uri");
  logger.info({ redirectUri, scope: new URL(url).searchParams.get("scope") }, "gmail/auth-url: returning OAuth URL");
  res.json({ url });
});

// Legacy browser-navigation route kept for backwards compat.
router.get("/gmail/connect", requireAuth, (req: Request, res: Response): void => {
  const state = signState(req.userId);
  const url = getAuthUrl(state);
  res.redirect(url);
});

router.get("/gmail/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  const frontendBase = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : "http://localhost:5173";

  if (error || !code || !state) {
    res.redirect(`${frontendBase}/inbox?gmail=error`);
    return;
  }

  const userId = verifyState(state);
  if (!userId) {
    res.redirect(`${frontendBase}/inbox?gmail=error`);
    return;
  }

  try {
    const { accessToken, refreshToken } = await exchangeCode(code);
    const email = await getGmailEmail(accessToken, refreshToken);

    await db
      .insert(gmailConnectionsTable)
      .values({ userId, accessToken, refreshToken, email })
      .onConflictDoUpdate({
        target: gmailConnectionsTable.userId,
        set: { accessToken, refreshToken, email, updatedAt: new Date() },
      });

    res.redirect(`${frontendBase}/inbox?gmail=connected`);
  } catch {
    res.redirect(`${frontendBase}/inbox?gmail=error`);
  }
});

router.get("/gmail/status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;

  const [conn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  if (!conn) {
    res.json({ connected: false, postingCount: 0 });
    return;
  }

  const postings = await db
    .select({ gmailMessageId: jobPostingsTable.gmailMessageId })
    .from(jobPostingsTable)
    .where(eq(jobPostingsTable.userId, userId));

  const postingCount = postings.filter((r) => r.gmailMessageId !== null).length;

  res.json({
    connected: true,
    email: conn.email,
    lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
    postingCount,
  });
});

router.delete("/gmail/disconnect", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;

  const [conn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  if (conn) {
    await revokeTokens(conn.refreshToken);
    await db
      .delete(gmailConnectionsTable)
      .where(eq(gmailConnectionsTable.userId, userId));
  }

  res.status(204).end();
});

router.post("/gmail/sync", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;

  const [conn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  if (!conn) {
    res.status(400).json({ error: "Gmail account not connected" });
    return;
  }

  const [userProfile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  const filterCriteria = userProfile?.emailFilterSettings ?? undefined;

  const emailsPreFilter = await estimateEmailCount(conn.accessToken, conn.refreshToken, filterCriteria);

  let emails: Awaited<ReturnType<typeof fetchJobEmails>>;
  try {
    emails = await fetchJobEmails(conn.accessToken, conn.refreshToken, filterCriteria);
  } catch (err) {
    if ((err as Error)?.message?.includes("invalid_grant")) {
      logger.warn({ userId }, "gmail sync: invalid_grant — removing stale connection");
      await db.delete(gmailConnectionsTable).where(eq(gmailConnectionsTable.userId, userId));
      res.status(401).json({
        error: "gmail_token_expired",
        message: "Gmail authorization has expired. Please reconnect your Gmail account.",
      });
      return;
    }
    throw err;
  }

  const seenKeys = await db
    .select({ gmailKey: gmailSeenKeysTable.gmailKey })
    .from(gmailSeenKeysTable)
    .where(eq(gmailSeenKeysTable.userId, userId));

  const processedBaseIds = new Set(
    seenKeys.map((r) => r.gmailKey.split(":")[0]),
  );

  const newEmails = emails.filter((e) => !processedBaseIds.has(e.messageId));
  let synced = 0;
  let jobsExtracted = 0;
  let jobsSkippedDedup = 0;
  let jobsSkippedActiveDup = 0;
  let jobsSkippedUserDeleted = 0;
  let jobsSkippedApplied = 0;

  for (const email of newEmails) {
    if (!email.body.trim()) continue;

    const { listings, hadError } = await extractJobListings(email.body, email.subject, email.sender);
    jobsExtracted += listings.length;

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (!listing.description.trim()) continue;

      const gmailKey = `${email.messageId}:${i}`;
      const title = listing.title || email.subject.slice(0, 200) || "Job Opportunity";
      const company = listing.company || extractSender(email.sender);

      await db
        .insert(gmailSeenKeysTable)
        .values({ userId, gmailKey })
        .onConflictDoNothing();

      const { isDuplicate, matchedTitle, matchedCompany, wasDeleted, wasApplied } = await isFuzzyDuplicate(userId, title, company);
      if (isDuplicate) {
        logger.info(
          { userId, title, company, matchedTitle, matchedCompany, wasDeleted, wasApplied },
          wasDeleted
            ? "gmail sync: skipping posting previously dismissed by user"
            : wasApplied
            ? "gmail sync: skipping posting already applied to"
            : "gmail sync: skipping fuzzy duplicate posting",
        );
        jobsSkippedDedup++;
        if (wasDeleted) jobsSkippedUserDeleted++;
        else if (wasApplied) jobsSkippedApplied++;
        else jobsSkippedActiveDup++;
        continue;
      }

      // Always fetch the job page when a URL is available:
      //  - Resolves tracking redirects (Lensa, Jobgether, etc.) → real job URL
      //  - Enriches description when the email excerpt is short
      let fullDescription = listing.description;
      const jobUrl = listing.url;
      let resolvedUrl = jobUrl;

      if (jobUrl) {
        const pageResult = await fetchJobPageContent(jobUrl);
        if (pageResult) {
          // Always capture finalUrl — real job URL after following tracking redirects.
          resolvedUrl = pageResult.finalUrl;
          if (pageResult.contentUsable && pageResult.content.length > fullDescription.length) {
            logger.info({ title, company, finalUrl: pageResult.finalUrl, chars: pageResult.content.length }, "gmail sync: using fetched page content");
            fullDescription = pageResult.content;
          } else if (pageResult.contentUsable) {
            logger.info({ title, company, finalUrl: pageResult.finalUrl }, "gmail sync: resolved URL, keeping email description");
          } else {
            logger.info({ title, company, jobUrl, finalUrl: pageResult.finalUrl }, "gmail sync: page content unusable, stored finalUrl, using email excerpt");
          }
        }
      }

      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId,
          title,
          company,
          fullDescription: fullDescription.slice(0, 10_000),
          link: resolvedUrl ?? null,
          source: "gmail",
          senderName: parseSenderName(email.sender),
          gmailMessageId: gmailKey,
          extractedSkills: [],
        })
        .onConflictDoNothing()
        .returning();
      if (newPosting) {
        scorePostingBackground(newPosting.id, userId);
        synced++;
      }
    }

    // Only mark as read when extraction succeeded — if the LLM call errored,
    // leave the email unread so the next sync automatically retries it.
    if (!hadError) {
      await markEmailAsRead(conn.accessToken, conn.refreshToken, email.messageId);
    } else {
      logger.warn({ messageId: email.messageId }, "gmail sync: extraction errored — leaving email unread for retry");
    }
  }

  const lastSyncedAt = new Date();
  await db
    .update(gmailConnectionsTable)
    .set({ lastSyncedAt, updatedAt: lastSyncedAt })
    .where(eq(gmailConnectionsTable.userId, userId));

  await db.insert(syncEventsTable).values({
    userId,
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

  sweepUnscoredPostings(userId).catch((err) => {
    logger.warn({ userId, err }, "gmail sync: sweep unscored postings failed");
  });

  res.json({
    synced,
    lastSyncedAt: lastSyncedAt.toISOString(),
  });
});

/**
 * POST /api/gmail/reprocess
 * Re-fetch specific Gmail messages by ID and run them through the full
 * extraction pipeline. Designed for emails that were previously marked
 * read during a failed sync (e.g. LLM error) and are no longer returned
 * by the normal is:unread query.
 */
router.post("/gmail/reprocess", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  const { messageIds } = req.body as { messageIds?: string[] };

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    res.status(400).json({ error: "messageIds must be a non-empty array of Gmail message IDs" });
    return;
  }

  const [conn] = await db
    .select()
    .from(gmailConnectionsTable)
    .where(eq(gmailConnectionsTable.userId, userId));

  if (!conn) {
    res.status(400).json({ error: "Gmail account not connected" });
    return;
  }

  const [userProfile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  const filterCriteria = userProfile?.emailFilterSettings ?? undefined;
  const blockedKeywords = filterCriteria?.blockedBodyKeywords ?? [];

  const seenKeys = await db
    .select({ gmailKey: gmailSeenKeysTable.gmailKey })
    .from(gmailSeenKeysTable)
    .where(eq(gmailSeenKeysTable.userId, userId));
  const processedBaseIds = new Set(seenKeys.map((r) => r.gmailKey.split(":")[0]));

  const results: Array<{ messageId: string; status: string; imported: number }> = [];

  for (const messageId of messageIds.slice(0, 20)) {
    if (processedBaseIds.has(messageId)) {
      results.push({ messageId, status: "already_processed", imported: 0 });
      continue;
    }

    const email = await fetchSingleEmail(conn.accessToken, conn.refreshToken, messageId);
    if (!email || !email.body.trim()) {
      results.push({ messageId, status: "not_found_or_empty", imported: 0 });
      continue;
    }

    const { listings, hadError } = await extractJobListings(email.body, email.subject, email.sender);
    if (hadError) {
      results.push({ messageId, status: "extraction_error", imported: 0 });
      continue;
    }
    if (listings.length === 0) {
      await markEmailAsRead(conn.accessToken, conn.refreshToken, messageId);
      results.push({ messageId, status: "no_listings", imported: 0 });
      continue;
    }

    let imported = 0;
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (!listing.description.trim()) continue;

      const gmailKey = `${messageId}:${i}`;
      const title = listing.title || email.subject.slice(0, 200) || "Job Opportunity";
      const company = listing.company || extractSender(email.sender);

      await db.insert(gmailSeenKeysTable).values({ userId, gmailKey }).onConflictDoNothing();

      const { isDuplicate } = await isFuzzyDuplicate(userId, title, company);
      if (isDuplicate) continue;

      let fullDescription = listing.description;
      let resolvedUrl = listing.url;
      if (listing.url) {
        const pageResult = await fetchJobPageContent(listing.url);
        if (pageResult) {
          resolvedUrl = pageResult.finalUrl;
          if (pageResult.contentUsable && pageResult.content.length > fullDescription.length) {
            fullDescription = pageResult.content;
          }
        }
      }

      // Check blocked body keywords
      if (blockedKeywords.length > 0) {
        const hit = blockedKeywords.find((kw) => fullDescription.toLowerCase().includes(kw.toLowerCase()));
        if (hit) continue;
      }

      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId,
          title,
          company,
          fullDescription: fullDescription.slice(0, 10_000),
          link: resolvedUrl ?? null,
          source: "gmail",
          senderName: parseSenderName(email.sender),
          gmailMessageId: gmailKey,
          extractedSkills: [],
        })
        .onConflictDoNothing()
        .returning();

      if (newPosting) {
        scorePostingBackground(newPosting.id, userId);
        imported++;
      }
    }

    await markEmailAsRead(conn.accessToken, conn.refreshToken, messageId);
    results.push({ messageId, status: imported > 0 ? "imported" : "all_skipped", imported });
  }

  res.json({ results });
});

function extractSender(from: string): string {
  const match = from.match(/^(?:"?([^"<]+)"?\s*)?<?.+>?$/);
  const name = match?.[1]?.trim();
  if (name && name.length > 0 && name.length <= 100) return name;
  const domainMatch = from.match(/@([^>@\s]+)/);
  return domainMatch?.[1] ?? from.slice(0, 100);
}

export default router;
