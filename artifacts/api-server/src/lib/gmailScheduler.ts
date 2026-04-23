import { eq } from "drizzle-orm";
import { db, gmailConnectionsTable, jobPostingsTable } from "@workspace/db";
import { fetchJobEmails } from "./gmailClient";
import { logger } from "./logger";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function syncAllUsers(): Promise<void> {
  const connections = await db.select().from(gmailConnectionsTable);

  if (connections.length === 0) {
    logger.debug("Gmail scheduler: no connected users, skipping sync");
    return;
  }

  logger.info(
    { count: connections.length },
    "Gmail scheduler: starting daily sync",
  );

  for (const conn of connections) {
    try {
      const emails = await fetchJobEmails(conn.accessToken, conn.refreshToken);

      const existingMsgIds = new Set(
        (
          await db
            .select({ gmailMessageId: jobPostingsTable.gmailMessageId })
            .from(jobPostingsTable)
            .where(eq(jobPostingsTable.userId, conn.userId))
        )
          .map((r) => r.gmailMessageId)
          .filter(Boolean) as string[],
      );

      const newEmails = emails.filter((e) => !existingMsgIds.has(e.messageId));
      let synced = 0;

      for (const email of newEmails) {
        if (!email.body.trim()) continue;
        await db.insert(jobPostingsTable).values({
          userId: conn.userId,
          title: email.subject.slice(0, 200) || "Job Opportunity",
          company: extractSender(email.sender),
          fullDescription: email.body.slice(0, 10_000),
          source: "gmail",
          gmailMessageId: email.messageId,
          extractedSkills: [],
        });
        synced++;
      }

      const lastSyncedAt = new Date();
      await db
        .update(gmailConnectionsTable)
        .set({ lastSyncedAt, updatedAt: lastSyncedAt })
        .where(eq(gmailConnectionsTable.userId, conn.userId));

      logger.info(
        { userId: conn.userId, synced },
        "Gmail scheduler: synced user",
      );
    } catch (err) {
      logger.error(
        { userId: conn.userId, err },
        "Gmail scheduler: failed to sync user",
      );
    }
  }
}

function extractSender(from: string): string {
  const match = from.match(/^(?:"?([^"<]+)"?\s*)?<?.+>?$/);
  const name = match?.[1]?.trim();
  if (name && name.length > 0 && name.length <= 100) return name;
  const domainMatch = from.match(/@([^>@\s]+)/);
  return domainMatch?.[1] ?? from.slice(0, 100);
}

export function startGmailScheduler(): void {
  logger.info(
    { intervalHours: 24 },
    "Gmail scheduler: starting daily sync interval",
  );

  setInterval(() => {
    syncAllUsers().catch((err) => {
      logger.error({ err }, "Gmail scheduler: unhandled error in sync cycle");
    });
  }, SYNC_INTERVAL_MS);
}
