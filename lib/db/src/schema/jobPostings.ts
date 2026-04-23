import { pgTable, text, integer, timestamp, serial, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jobPostingsTable = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  company: text("company").notNull(),
  link: text("link"),
  fullDescription: text("full_description").notNull(),
  extractedSkills: text("extracted_skills").array().notNull().default([]),
  requiredSkills: text("required_skills").array().notNull().default([]),
  niceToHaveSkills: text("nice_to_have_skills").array().notNull().default([]),
  minYearsExperience: integer("min_years_experience"),
  remoteType: text("remote_type"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  source: text("source").notNull().default("manual"),
  gmailMessageId: text("gmail_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("job_postings_user_gmail_key").on(table.userId, table.gmailMessageId),
]);

export const insertJobPostingSchema = createInsertSchema(jobPostingsTable).omit({ id: true, createdAt: true });
export type InsertJobPosting = z.infer<typeof insertJobPostingSchema>;
export type JobPosting = typeof jobPostingsTable.$inferSelect;
