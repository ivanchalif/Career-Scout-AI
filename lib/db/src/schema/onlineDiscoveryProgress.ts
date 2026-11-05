import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type DiscoveryReport = {
  retrieved: number;
  alreadySaved: number;
  repeated: number;
  excluded: number;
  recentlyChecked: number;
  deferred: number;
  imported: number;
  pageChecks: number;
  unverified: number;
  sourceFailures: number;
  searchRequests: number;
};

export type DiscoveryProgress = {
  cursors: Record<string, { signature: string; run: number }>;
  rejected: Record<string, { context: string; expiresAt: number }>;
  lastReport?: DiscoveryReport;
  sourceRuns?: Record<string, Array<{
    at: string;
    addedPostingIds: number[];
    error: string | null;
    recoveryNotes?: string[];
  }>>;
};

export const onlineDiscoveryProgressTable = pgTable("online_discovery_progress", {
  userId: text("user_id").primaryKey(),
  state: jsonb("state").$type<DiscoveryProgress>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOnlineDiscoveryProgressSchema = createInsertSchema(onlineDiscoveryProgressTable).omit({ updatedAt: true });
export type InsertOnlineDiscoveryProgress = z.infer<typeof insertOnlineDiscoveryProgressSchema>;
