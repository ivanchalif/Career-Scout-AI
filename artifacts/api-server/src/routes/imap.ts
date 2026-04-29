import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, imapConnectionsTable, jobPostingsTable, gmailSeenKeysTable, userProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { testImapConnection, fetchImapJobEmails } from "../lib/imapClient";
import { extractJobListings, scorePostingBackground, sweepUnscoredPostings } from "../lib/scoringService";
import { isFuzzyDuplicate } from "../lib/dedup";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/imap/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const [conn] = await db
    .select()
    .from(imapConnectionsTable)
    .where(eq(imapConnectionsTable.userId, userId));

  if (!conn) {
    res.json({ connected: false });
    return;
  }

  res.json({
    connected: true,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    tls: conn.tls,
    lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
    postingCount: conn.postingCount,
  });
});

router.post("/imap/connect", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  const { host, port, username, password, tls } = req.body as {
    host: string;
    port: number;
    username: string;
    password: string;
    tls: boolean;
  };

  if (!host || !port || !username || !password) {
    res.status(400).json({ error: "host, port, username, and password are required" });
    return;
  }

  try {
    await testImapConnection({ host, port, username, password, tls: tls ?? true });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
    return;
  }

  await db
    .insert(imapConnectionsTable)
    .values({ userId, host, port, username, password, tls: tls ?? true })
    .onConflictDoUpdate({
      target: imapConnectionsTable.userId,
      set: { host, port, username, password, tls: tls ?? true, updatedAt: new Date() },
    });

  res.json({ connected: true, host, port, username, tls: tls ?? true });
});

router.delete("/imap/disconnect", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;
  await db.delete(imapConnectionsTable).where(eq(imapConnectionsTable.userId, userId));
  res.json({ ok: true });
});

router.post("/imap/sync", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId;

  const [conn] = await db
    .select()
    .from(imapConnectionsTable)
    .where(eq(imapConnectionsTable.userId, userId));

  if (!conn) {
    res.status(400).json({ error: "No IMAP connection configured" });
    return;
  }

  try {
    const [userProfile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
    const filterCriteria = userProfile?.emailFilterSettings ?? undefined;
    const emails = await fetchImapJobEmails({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      tls: conn.tls,
    }, filterCriteria);

    const seenKeys = await db
      .select({ gmailKey: gmailSeenKeysTable.gmailKey })
      .from(gmailSeenKeysTable)
      .where(eq(gmailSeenKeysTable.userId, userId));

    const processedKeys = new Set(seenKeys.map((r) => r.gmailKey));
    let synced = 0;

    for (const email of emails) {
      if (!email.body.trim()) continue;

      const listings = await extractJobListings(email.body, email.subject, email.sender);

      for (let i = 0; i < listings.length; i++) {
        const listing = listings[i];
        if (!listing.description.trim()) continue;

        const seenKey = `${email.messageId}:${i}`;
        if (processedKeys.has(seenKey)) continue;

        await db
          .insert(gmailSeenKeysTable)
          .values({ userId, gmailKey: seenKey })
          .onConflictDoNothing();

        const title = listing.title || email.subject.slice(0, 200) || "Job Opportunity";
        const company = listing.company || email.sender.replace(/<[^>]+>/g, "").trim().split("@")[0] || "Unknown";

        const { isDuplicate, matchedTitle, matchedCompany } = await isFuzzyDuplicate(userId, title, company);
        if (isDuplicate) {
          logger.info(
            { userId, title, company, matchedTitle, matchedCompany },
            "imap sync: skipping fuzzy duplicate posting",
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
            link: listing.url ?? null,
            source: "imap",
            gmailMessageId: seenKey,
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

    const now = new Date();
    await db
      .update(imapConnectionsTable)
      .set({
        lastSyncedAt: now,
        postingCount: conn.postingCount + synced,
        updatedAt: now,
      })
      .where(eq(imapConnectionsTable.userId, userId));

    sweepUnscoredPostings(userId).catch((err) => {
      logger.warn({ userId, err }, "IMAP sync: sweep unscored postings failed");
    });

    res.json({ synced });
  } catch (err) {
    logger.error({ userId, err }, "IMAP sync failed");
    res.status(500).json({ error: "IMAP sync failed. Check your connection settings." });
  }
});

export default router;
