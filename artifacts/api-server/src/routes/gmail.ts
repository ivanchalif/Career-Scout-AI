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

    const listings = await extractJobListings(email.body, email.subject, email.sender);
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

    // Mark the email as read in Gmail now that all its listings have been processed
    await markEmailAsRead(conn.accessToken, conn.refreshToken, email.messageId);
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

function extractSender(from: string): string {
  const match = from.match(/^(?:"?([^"<]+)"?\s*)?<?.+>?$/);
  const name = match?.[1]?.trim();
  if (name && name.length > 0 && name.length <= 100) return name;
  const domainMatch = from.match(/@([^>@\s]+)/);
  return domainMatch?.[1] ?? from.slice(0, 100);
}

export default router;
