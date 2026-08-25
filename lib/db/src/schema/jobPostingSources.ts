import { boolean, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * References to the same logical opportunity as it appears in different feeds,
 * email alerts, or reposts. Job postings remain the user-facing entity; these
 * rows preserve provenance without creating duplicate cards.
 */
export const jobPostingSourcesTable = pgTable("job_posting_sources", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobPostingId: integer("job_posting_id").notNull(),
  provider: text("provider").notNull(),
  sourceJobId: text("source_job_id"),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("job_posting_sources_user_canonical_url").on(table.userId, table.canonicalUrl),
  unique("job_posting_sources_posting_provider_url").on(table.jobPostingId, table.provider, table.canonicalUrl),
]);

export const insertJobPostingSourceSchema = createInsertSchema(jobPostingSourcesTable).omit({
  id: true,
  firstSeenAt: true,
  lastSeenAt: true,
});
export type InsertJobPostingSource = z.infer<typeof insertJobPostingSourceSchema>;
export type JobPostingSource = typeof jobPostingSourcesTable.$inferSelect;