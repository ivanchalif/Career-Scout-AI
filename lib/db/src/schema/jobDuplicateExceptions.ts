import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jobDuplicateExceptionsTable = pgTable("job_duplicate_exceptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  postingIdLow: integer("posting_id_low").notNull(),
  postingIdHigh: integer("posting_id_high").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("job_duplicate_exceptions_user_pair").on(table.userId, table.postingIdLow, table.postingIdHigh)]);
export const insertJobDuplicateExceptionSchema = createInsertSchema(jobDuplicateExceptionsTable).omit({ id: true, createdAt: true });
export type JobDuplicateException = typeof jobDuplicateExceptionsTable.$inferSelect;
export type InsertJobDuplicateException = z.infer<typeof insertJobDuplicateExceptionSchema>;
