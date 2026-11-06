import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { validatePublicPageUrl } from "./pageScraper";
import { db, imapConnectionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const PREFIX = "encrypted:v1:";
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Mailbox credential encryption is not configured");
  return Buffer.from(hkdfSync("sha256", secret, "career-scout", "mailbox-credentials-v1", 32));
}

export function encryptMailboxPassword(password: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function decryptMailboxPassword(value: string, userId: string): string {
  if (!value.startsWith(PREFIX)) return value; // Legacy rows are upgraded before use.
  const parts = value.slice(PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted mailbox credentials");
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv!);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString("utf8");
}

export function isEncryptedMailboxPassword(value: string): boolean {
  return value.startsWith(PREFIX);
}

export async function validateMailboxTarget(host: string, port: number, tls: boolean): Promise<void> {
  if (!tls || port !== 993 || !/^[a-z0-9.-]+$/i.test(host)) {
    throw new Error("Use a public IMAP hostname, port 993, and verified TLS");
  }
  await validatePublicPageUrl(`https://${host}`);
}

/** Upgrade legacy plaintext rows on startup, without exposing credentials in logs. */
export async function protectLegacyMailboxCredentials(): Promise<void> {
  const connections = await db.select().from(imapConnectionsTable);
  for (const conn of connections) {
    if (isEncryptedMailboxPassword(conn.password)) continue;
    await db.update(imapConnectionsTable)
      .set({ password: encryptMailboxPassword(conn.password, conn.userId) })
      .where(and(eq(imapConnectionsTable.userId, conn.userId), eq(imapConnectionsTable.password, conn.password)));
  }
}
