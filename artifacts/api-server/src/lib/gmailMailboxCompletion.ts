import { db, gmailSeenKeysTable } from "@workspace/db";
import { markEmailAsRead } from "./gmailClient";

type GmailMailboxConnection = { userId: string; accessToken: string; refreshToken: string };

/** Call only after a durable :complete outcome. Pending survives read/archived
 * query changes, network errors and restarts; acknowledgment follows Google.
 */
export async function finalizeGmailMailboxMessage(conn: GmailMailboxConnection, messageId: string) {
  await db.insert(gmailSeenKeysTable).values({
    userId: conn.userId, gmailKey: `${messageId}:mailbox_pending`,
  }).onConflictDoNothing();
  await markEmailAsRead(conn.accessToken, conn.refreshToken, messageId);
  await db.insert(gmailSeenKeysTable).values({
    userId: conn.userId, gmailKey: `${messageId}:mailbox_done`,
  }).onConflictDoNothing();
}
