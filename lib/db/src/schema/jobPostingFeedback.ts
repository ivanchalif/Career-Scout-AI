import { pgTable, text, integer, timestamp, serial, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jobPostingFeedbackTable = pgTable("job_posting_feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobPostingId: integer("job_posting_id").notNull(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("job_posting_feedback_user_posting_key").on(table.userId, table.jobPostingId),
]);

export const insertJobPostingFeedbackSchema = createInsertSchema(jobPostingFeedbackTable).omit({ id: true, createdAt: true });
export type InsertJobPostingFeedback = z.infer<typeof insertJobPostingFeedbackSchema>;
export type JobPostingFeedback = typeof jobPostingFeedbackTable.$inferSelect;