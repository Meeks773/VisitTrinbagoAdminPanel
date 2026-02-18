import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const CATEGORIES = [
  "nightlife",
  "beaches",
  "wellness",
  "festivals",
  "stay",
  "transport",
  "business",
  "tours",
  "eat_drink",
  "attractions",
  "shopping",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  nightlife: "Nightlife",
  beaches: "Beaches",
  wellness: "Wellness",
  festivals: "Festivals",
  stay: "Stay",
  transport: "Getting Around",
  business: "Business",
  tours: "Tours",
  eat_drink: "Eat & Drink",
  attractions: "Attractions",
  shopping: "Shopping",
};

export const listings = pgTable("listings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  interest: text("interest").notNull(),
  subInterest: text("sub_interest").notNull(),
  description: text("description").notNull(),
  featuredImage: text("featured_image"),
  galleryImages: text("gallery_images").array(),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  website: text("website"),
  phone: text("phone"),
  email: text("email"),
  rewardPoints: integer("reward_points").default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertListingSchema = createInsertSchema(listings).omit({
  id: true,
  createdAt: true,
});

export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

export const EVENT_CATEGORIES = [
  "Concert",
  "Festival",
  "Exhibition",
  "Workshop",
  "Sports",
  "Cultural",
  "Food & Drink",
  "Community",
  "Conference",
  "Carnival",
  "Religious",
  "Other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const events = pgTable("events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  eventCategory: text("event_category").notNull(),
  interest: text("interest").notNull(),
  subInterest: text("sub_interest").notNull(),
  description: text("description").notNull(),
  startDateTime: text("start_date_time").notNull(),
  endDateTime: text("end_date_time").notNull(),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  isFreeEvent: boolean("is_free_event").default(true),
  featuredImage: text("featured_image"),
  galleryImages: text("gallery_images").array(),
  videoUrls: text("video_urls").array(),
  website: text("website"),
  bookingUrl: text("booking_url"),
  organizerName: text("organizer_name"),
  phone: text("phone"),
  email: text("email"),
  dressCode: text("dress_code"),
  rewardPoints: integer("reward_points").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export * from "./models/chat";
