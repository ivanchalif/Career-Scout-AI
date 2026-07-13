import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const syncEventsTable = pgTable("sync_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  source: text("source").notNull().$type<"gmail" | "imap">(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  emailsFetched: integer("emails_fetched").notNull().default(0),
  jobsExtracted: integer("jobs_extracted").notNull().default(0),
  jobsImported: integer("jobs_imported").notNull().default(0),
  jobsSkippedDedup: integer("jobs_skipped_dedup").notNull().default(0),
});
