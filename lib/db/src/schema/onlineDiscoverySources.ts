import { boolean, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const onlineDiscoverySourcesTable = pgTable("online_discovery_sources", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull().$type<"builtin" | "custom">(),
  isSuppressed: boolean("is_suppressed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("online_discovery_sources_user_provider_url").on(table.userId, table.provider, table.url),
]);

export const insertOnlineDiscoverySourceSchema = createInsertSchema(onlineDiscoverySourcesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOnlineDiscoverySource = z.infer<typeof insertOnlineDiscoverySourceSchema>;
export type OnlineDiscoverySource = typeof onlineDiscoverySourcesTable.$inferSelect;