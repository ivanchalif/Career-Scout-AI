import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable } from "@workspace/db";
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

  const existingKeys = (
    await db
      .select({ gmailMessageId: jobPostingsTable.gmailMessageId })
      .from(jobPostingsTable)
      .where(eq(jobPostingsTable.userId, userId))
  )
    .map((r) => r.gmailMessageId)
    .filter(Boolean) as string[];

  const processedBaseIds = new Set(existingKeys.map((k) => k.split(":")[0]));

  const newEmails = emails.filter((e) => !processedBaseIds.has(e.messageId));
  let synced = 0;

  for (const email of newEmails) {
    if (!email.body.trim()) continue;

    const listings = await extractJobListings(email.body, email.subject, email.sender);

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (!listing.description.trim()) continue;

      const gmailMessageId = `${email.messageId}:${i}`;
      const [newPosting] = await db
        .insert(jobPostingsTable)
        .values({
          userId,
          title: listing.title || email.subject.slice(0, 200) || "Job Opportunity",
          company: listing.company || extractSender(email.sender),
          fullDescription: listing.description.slice(0, 10_000),
          source: "gmail",
          gmailMessageId,
          extractedSkills: [],
        })
        .returning();
      if (newPosting) {
        scorePostingBackground(newPosting.id, userId);
      }
      synced++;
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
