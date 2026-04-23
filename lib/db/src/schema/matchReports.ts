import { pgTable, text, integer, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const matchReportsTable = pgTable("match_reports", {
  id: serial("id").primaryKey(),
  jobPostingId: integer("job_posting_id").notNull(),
  userId: text("user_id").notNull(),
  fitScore: integer("fit_score"),
  reasoning: text("reasoning"),
  compensationGap: integer("compensation_gap"),
  matchedSkills: text("matched_skills").array().notNull().default([]),
  missingSkills: text("missing_skills").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMatchReportSchema = createInsertSchema(matchReportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMatchReport = z.infer<typeof insertMatchReportSchema>;
export type MatchReport = typeof matchReportsTable.$inferSelect;
