import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type FilteredEmailReason =
  | "blocked_sender"
  | "application_response"
  | "body_keyword"
  | "duplicate"
  | "duplicate_dismissed"
  | "duplicate_applied";

export const filteredEmailsTable = pgTable("filtered_emails", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  gmailMessageId: text("gmail_message_id").notNull(),
  subject: text("subject").notNull().default(""),
  senderEmail: text("sender_email").notNull().default(""),
  senderName: text("sender_name"),
  reason: text("reason").notNull().$type<FilteredEmailReason>(),
  blockedKeyword: text("blocked_keyword"),
  listingTitle: text("listing_title"),
  listingCompany: text("listing_company"),
  filteredAt: timestamp("filtered_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FilteredEmail = typeof filteredEmailsTable.$inferSelect;
