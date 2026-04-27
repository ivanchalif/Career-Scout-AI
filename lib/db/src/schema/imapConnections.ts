import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const imapConnectionsTable = pgTable("imap_connections", {
  userId: text("user_id").primaryKey(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  tls: boolean("tls").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  postingCount: integer("posting_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ImapConnection = typeof imapConnectionsTable.$inferSelect;
