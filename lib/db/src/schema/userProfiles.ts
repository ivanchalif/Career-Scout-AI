import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  syncScheduleHours: integer("sync_schedule_hours"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserProfileSchema = createInsertSchema(userProfilesTable).omit({ createdAt: true, updatedAt: true });
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfilesTable.$inferSelect;
