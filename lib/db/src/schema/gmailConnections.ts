import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gmailConnectionsTable = pgTable("gmail_connections", {
  userId: text("user_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  email: text("email"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGmailConnectionSchema = createInsertSchema(gmailConnectionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertGmailConnection = z.infer<typeof insertGmailConnectionSchema>;
export type GmailConnection = typeof gmailConnectionsTable.$inferSelect;
