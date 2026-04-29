import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable, gmailSeenKeysTable, userProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getAuthUrl,
  exchangeCode,
  getGmailEmail,
  revokeTokens,
  fetchJobEmails,
  markEmailAsRead,
  signState,
  verifyState,
} from "../lib/gmailClient";
import { scorePostingBackground, sweepUnscoredPostings, extractJobListings } from "../lib/scoringService";
import { isFuzzyDuplicate } from "../lib/dedup";
import { logger } from "../lib/logger";

/**
 * Fetches a job posting URL and returns the extracted plain-text content.
 * Returns empty string on any failure (network error, non-200, timeout, etc.).
 */
async function fetchJobPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CareerScout/1.0; +https://career-scout.app)",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return "";

    const html = await response.text();
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 12_000);
  } catch {
    return "";
  }
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
  const emails = await fetchJobEmails(conn.accessToken, conn.refreshToken, filterCriteria);

  const seenKeys = await db
    .select({ gmailKey: gmailSeenKeysTable.gmailKey })
    .from(gmailSeenKeysTable)
    .where(eq(gmailSeenKeysTable.userId, userId));

  const processedBaseIds = new Set(
    seenKeys.map((r) => r.gmailKey.split(":")[0]),
  );

  const newEmails = emails.filter((e) => !processedBaseIds.has(e.messageId));
  let synced = 0;

  for (const email of newEmails) {
    if (!email.body.trim()) continue;

    const listings = await extractJobListings(email.body, email.subject, email.sender);

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

      const { isDuplicate, matchedTitle, matchedCompany } = await isFuzzyDuplicate(userId, title, company);
      if (isDuplicate) {
        logger.info(
          { userId, title, company, matchedTitle, matchedCompany },
          "gmail sync: skipping fuzzy duplicate posting",
        );
        continue;
      }

      // If the email only has a short snippet, try to fetch the full job page
      let fullDescription = listing.description;
      const jobUrl = listing.url;

      if (jobUrl && fullDescription.trim().length < 800) {
        logger.info({ title, company, jobUrl }, "gmail sync: description short, fetching job page");
        const pageContent = await fetchJobPage(jobUrl);
        if (pageContent.length > fullDescription.length) {
          logger.info({ title, company, chars: pageContent.length }, "gmail sync: using fetched page content");
          fullDescription = pageContent;
        }
      }

      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId,
          title,
          company,
          fullDescription: fullDescription.slice(0, 10_000),
          link: jobUrl ?? null,
          source: "gmail",
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
