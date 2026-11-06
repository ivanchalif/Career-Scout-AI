import { boolean, integer, pgTable, timestamp, text, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scoringJobsTable = pgTable("scoring_jobs", {
  userId: text("user_id").notNull(),
  postingId: integer("posting_id").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  generation: integer("generation").notNull().default(1),
  forceParse: boolean("force_parse").notNull().default(false),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
}, (table) => [
  unique("scoring_jobs_user_posting").on(table.userId, table.postingId),
  index("scoring_jobs_due").on(table.status, table.runAfter),
]);
export const insertScoringJobSchema = createInsertSchema(scoringJobsTable);
export type ScoringJob = typeof scoringJobsTable.$inferSelect;
export type InsertScoringJob = z.infer<typeof insertScoringJobSchema>;
