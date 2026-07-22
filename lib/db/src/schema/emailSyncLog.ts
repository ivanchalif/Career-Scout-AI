import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export type EmailSyncOutcome =
  | "imported"
  | "partial"
  | "no_listings"
  | "all_skipped"
  | "skipped_blocked_sender"
  | "skipped_application_response"
  | "empty_body";

export const emailSyncLogTable = pgTable("email_sync_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  gmailMessageId: text("gmail_message_id").notNull(),
  subject: text("subject").notNull().default(""),
  senderEmail: text("sender_email").notNull().default(""),
  senderName: text("sender_name"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  outcome: text("outcome").notNull().$type<EmailSyncOutcome>(),
  listingsExtracted: integer("listings_extracted").notNull().default(0),
  listingsImported: integer("listings_imported").notNull().default(0),
  listingsSkipped: integer("listings_skipped").notNull().default(0),
  skipReasons: text("skip_reasons").array().notNull().default([]),
});

export type EmailSyncLog = typeof emailSyncLogTable.$inferSelect;
