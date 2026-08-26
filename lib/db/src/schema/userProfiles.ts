import { boolean, pgTable, text, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userProfilesTable = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  skills: text("skills").array().notNull().default([]),
  experienceHistory: jsonb("experience_history").notNull().default([]),
  education: text("education"),
  targetSalary: integer("target_salary"),
  remotePreference: text("remote_preference").notNull().default("hybrid"),
  remotePreferences: text("remote_preferences").array().notNull().default([]),
  locationPreferences: text("location_preferences").array().notNull().default([]),
  resumeUrl: text("resume_url"),
  resumeText: text("resume_text"),
  syncScheduleHours: real("sync_schedule_hours"),
  onlineDiscoveryScheduleHours: real("online_discovery_schedule_hours"),
  onlineDiscoveryMinMatchScore: integer("online_discovery_min_match_score").notNull().default(12),
  onlineDiscoverySourcesInitialized: boolean("online_discovery_sources_initialized").notNull().default(false),
  lastOnlineDiscoveryAt: timestamp("last_online_discovery_at", { withTimezone: true }),
  lastOnlineDiscoveryFound: integer("last_online_discovery_found").notNull().default(0),
  lastOnlineDiscoveryImported: integer("last_online_discovery_imported").notNull().default(0),
  lastOnlineDiscoveryDuplicates: integer("last_online_discovery_duplicates").notNull().default(0),
  lastOnlineDiscoveryError: text("last_online_discovery_error"),
  companyFilterSettings: jsonb("company_filter_settings").$type<{
    mode: "off" | "include" | "exclude";
    companies: string[];
  }>().notNull().default({ mode: "off", companies: [] }),
  titleExcludeKeywords: jsonb("title_exclude_keywords").$type<string[]>().notNull().default([]),
  emailFilterSettings: jsonb("email_filter_settings").$type<{
    subjectKeywords: string[];
    fromAddresses: string[];
    bodyKeywords: string[];
    blockedBodyKeywords: string[];
  }>().notNull().default({
    subjectKeywords: [
      "job", "jobs", "opportunity", "role", "position", "hiring", "offer",
      "recruiter", "job alert", "job opportunity", "open position",
      "just posted", "great match", "job matches", "job recommendations",
      "recommended jobs", "jobs you might like", "new jobs", "you may be a fit",
      "new job:", "are hiring",
    ],
    fromAddresses: [],
    bodyKeywords: [],
    blockedBodyKeywords: [],
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserProfileSchema = createInsertSchema(userProfilesTable).omit({ createdAt: true, updatedAt: true });
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfilesTable.$inferSelect;
