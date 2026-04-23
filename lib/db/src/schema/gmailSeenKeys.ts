import { pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const gmailSeenKeysTable = pgTable(
  "gmail_seen_keys",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    gmailKey: text("gmail_key").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.gmailKey)],
);
