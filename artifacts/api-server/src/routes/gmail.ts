import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable, gmailSeenKeysTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getAuthUrl,
  exchangeCode,
  getGmailEmail,
  revokeTokens,
  fetchJobEmails,
  signState,
  verifyState,
} from "../lib/gmailClient";
import { scorePostingBackground, sweepUnscoredPostings, extractJobListings } from "../lib/scoringService";
import { logger } from "../lib/logger";

function normalizeFuzzy(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|ag|plc|sa|technologies|technology|tech|solutions|group|holdings|services)\.?\b/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function isFuzzyDuplicate(
  userId: string,
  title: string,
  company: string,
): Promise<{ isDuplicate: boolean; matchedTitle?: string; matchedCompany?: string }> {
  const normTitle = normalizeFuzzy(title);
  const normCompany = normalizeFuzzy(company);

  if (!normTitle || !normCompany) return { isDuplicate: false };

  const rows = await db.execute(sql`
    SELECT id, title, company
    FROM job_postings
    WHERE user_id = ${userId}
      AND similarity(
        regexp_replace(lower(title),   '[^a-z0-9 ]', ' ', 'g'),
        ${normTitle}
      ) > 0.75
      AND similarity(
        regexp_replace(regexp_replace(lower(company), '\s*\([^)]*\)', ' ', 'g'), '[^a-z0-9 ]', ' ', 'g'),
        ${normCompany}
      ) > 0.65
    LIMIT 1
  `);

  if (rows.rows.length > 0) {
    const match = rows.rows[0] as { title: string; company: string };
    return { isDuplicate: true, matchedTitle: match.title, matchedCompany: match.company };
  }
  return { isDuplicate: false };
}

const router: IRouter = Router();

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
    res.redirect(`${frontendBase}/profile?gmail=error`);
    return;
  }

  const userId = verifyState(state);
  if (!userId) {
    res.redirect(`${frontendBase}/profile?gmail=error`);
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

    res.redirect(`${frontendBase}/profile?gmail=connected`);
  } catch {
    res.redirect(`${frontendBase}/profile?gmail=error`);
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

  const emails = await fetchJobEmails(conn.accessToken, conn.refreshToken);

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

      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId,
          title,
          company,
          fullDescription: listing.description.slice(0, 10_000),
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
