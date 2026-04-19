import { type Listing, type InsertListing, listings, type Event, type InsertEvent, events } from "@shared/schema";
import { db } from "./db";
import { eq, and, ilike, or, sql, desc, asc } from "drizzle-orm";

export interface PublicQueryOptions {
  category?: string;
  search?: string;
  subInterest?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  sort?: "name" | "reward_points" | "newest" | "distance";
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface PublicEventQueryOptions {
  eventCategory?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sort?: "name" | "date" | "newest";
  page?: number;
  limit?: number;
}

export interface AnalyticsData {
  totals: {
    listings: number;
    events: number;
    upcomingEvents: number;
    pastEvents: number;
    freeEvents: number;
    paidEvents: number;
    listingRewardPoints: number;
    eventRewardPoints: number;
    avgListingRewardPoints: number;
    avgEventRewardPoints: number;
  };
  listingsByCategory: { category: string; count: number; rewardTotal: number; rewardAvg: number }[];
  eventsByCategory: { category: string; count: number }[];
  dataQuality: {
    listingsTotal: number;
    missingWebsite: number;
    missingPhone: number;
    missingCoordinates: number;
    missingFeaturedImage: number;
    missingGallery: number;
    shortDescription: number;
  };
  geographic: {
    trinidad: number;
    tobago: number;
    unknown: number;
  };
  topRewardListings: { id: number; name: string; category: string; rewardPoints: number }[];
  topRewardEvents: { id: number; name: string; eventCategory: string; rewardPoints: number; startDateTime: string }[];
  listingsCreatedByMonth: { month: string; count: number }[];
  eventsCreatedByMonth: { month: string; count: number }[];
  upcomingEventsByWeek: { weekStart: string; count: number }[];
  topOrganizers: { name: string; count: number }[];
}

export interface IStorage {
  getListings(category?: string): Promise<Listing[]>;
  getListing(id: number): Promise<Listing | undefined>;
  createListing(data: InsertListing): Promise<Listing>;
  updateListing(id: number, data: Partial<InsertListing>): Promise<Listing | undefined>;
  deleteListing(id: number): Promise<boolean>;
  getPublicListings(options: PublicQueryOptions): Promise<PaginatedResult<Listing>>;
  getCategoryCounts(): Promise<Record<string, number>>;
  getEvents(): Promise<Event[]>;
  getEvent(id: number): Promise<Event | undefined>;
  createEvent(data: InsertEvent): Promise<Event>;
  updateEvent(id: number, data: Partial<InsertEvent>): Promise<Event | undefined>;
  deleteEvent(id: number): Promise<boolean>;
  getEventCount(): Promise<number>;
  getPublicEvents(options: PublicEventQueryOptions): Promise<PaginatedResult<Event>>;
  getAnalytics(): Promise<AnalyticsData>;
}

export class DatabaseStorage implements IStorage {
  async getListings(category?: string): Promise<Listing[]> {
    if (category) {
      return db.select().from(listings).where(eq(listings.category, category));
    }
    return db.select().from(listings);
  }

  async getListing(id: number): Promise<Listing | undefined> {
    const [listing] = await db.select().from(listings).where(eq(listings.id, id));
    return listing;
  }

  async createListing(data: InsertListing): Promise<Listing> {
    const [listing] = await db.insert(listings).values(data as any).returning();
    return listing;
  }

  async updateListing(id: number, data: Partial<InsertListing>): Promise<Listing | undefined> {
    const [listing] = await db.update(listings).set(data).where(eq(listings.id, id)).returning();
    return listing;
  }

  async deleteListing(id: number): Promise<boolean> {
    const result = await db.delete(listings).where(eq(listings.id, id)).returning();
    return result.length > 0;
  }

  async getPublicListings(options: PublicQueryOptions): Promise<PaginatedResult<Listing>> {
    const {
      category,
      search,
      subInterest,
      lat,
      lng,
      radius = 25,
      sort = "newest",
      page = 1,
      limit = 20,
    } = options;

    const conditions = [];

    if (category) {
      conditions.push(eq(listings.category, category));
    }

    if (subInterest) {
      conditions.push(eq(listings.subInterest, subInterest));
    }

    if (search) {
      conditions.push(
        or(
          ilike(listings.name, `%${search}%`),
          ilike(listings.description, `%${search}%`),
          ilike(listings.subInterest, `%${search}%`),
          ilike(listings.location, `%${search}%`)
        )!
      );
    }

    const isNearbySearch = lat != null && lng != null;

    if (isNearbySearch) {
      const kmPerDegreeLat = 111.0;
      const cosLat = Math.cos((lat! * Math.PI) / 180);
      const maxDistSq = radius * radius;
      conditions.push(
        sql`${listings.latitude} IS NOT NULL AND ${listings.longitude} IS NOT NULL AND (
          POWER((${listings.latitude} - ${lat!}) * ${kmPerDegreeLat}, 2) +
          POWER((${listings.longitude} - ${lng!}) * ${kmPerDegreeLat * cosLat}, 2)
        ) <= ${maxDistSq}`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    let orderClause;
    if (isNearbySearch && sort === "distance") {
      const kmPerDegreeLat = 111.0;
      const cosLat = Math.cos((lat! * Math.PI) / 180);
      orderClause = sql`(
        POWER((${listings.latitude} - ${lat!}) * ${kmPerDegreeLat}, 2) +
        POWER((${listings.longitude} - ${lng!}) * ${kmPerDegreeLat * cosLat}, 2)
      ) ASC`;
    } else if (sort === "name") {
      orderClause = asc(listings.name);
    } else if (sort === "reward_points") {
      orderClause = desc(listings.rewardPoints);
    } else {
      orderClause = desc(listings.createdAt);
    }

    const offset = (page - 1) * limit;

    const results = await db
      .select()
      .from(listings)
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async getCategoryCounts(): Promise<Record<string, number>> {
    const results = await db
      .select({
        category: listings.category,
        count: sql<number>`count(*)::int`,
      })
      .from(listings)
      .groupBy(listings.category);

    const counts: Record<string, number> = {};
    for (const row of results) {
      counts[row.category] = row.count;
    }
    return counts;
  }

  async getEvents(): Promise<Event[]> {
    return db.select().from(events).orderBy(desc(events.createdAt));
  }

  async getEvent(id: number): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.id, id));
    return event;
  }

  async createEvent(data: InsertEvent): Promise<Event> {
    const [event] = await db.insert(events).values(data as any).returning();
    return event;
  }

  async updateEvent(id: number, data: Partial<InsertEvent>): Promise<Event | undefined> {
    const [event] = await db.update(events).set(data).where(eq(events.id, id)).returning();
    return event;
  }

  async deleteEvent(id: number): Promise<boolean> {
    const result = await db.delete(events).where(eq(events.id, id)).returning();
    return result.length > 0;
  }

  async getEventCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(events);
    return result[0]?.count ?? 0;
  }

  async getPublicEvents(options: PublicEventQueryOptions): Promise<PaginatedResult<Event>> {
    const {
      eventCategory,
      search,
      startDate,
      endDate,
      sort = "date",
      page = 1,
      limit = 20,
    } = options;

    const conditions: any[] = [];

    if (eventCategory) {
      conditions.push(eq(events.eventCategory, eventCategory));
    }

    if (search) {
      conditions.push(
        or(
          ilike(events.name, `%${search}%`),
          ilike(events.description, `%${search}%`),
          ilike(events.location, `%${search}%`),
          ilike(events.organizerName, `%${search}%`)
        )!
      );
    }

    if (startDate) {
      conditions.push(sql`${events.startDateTime} >= ${startDate}`);
    }

    if (endDate) {
      conditions.push(sql`${events.startDateTime} <= ${endDate}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(whereClause);
    const total = countResult[0]?.count ?? 0;

    let orderClause;
    if (sort === "name") {
      orderClause = asc(events.name);
    } else if (sort === "date") {
      orderClause = asc(events.startDateTime);
    } else {
      orderClause = desc(events.createdAt);
    }

    const offset = (page - 1) * limit;

    const results = await db
      .select()
      .from(events)
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset);

    const totalPages = Math.ceil(total / limit);

    return {
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async getAnalytics(): Promise<AnalyticsData> {
    const allListings = await db.select().from(listings);
    const allEvents = await db.select().from(events);

    const nowIso = new Date().toISOString();

    const upcomingEvents = allEvents.filter((e) => e.startDateTime >= nowIso);
    const pastEvents = allEvents.filter((e) => e.startDateTime < nowIso);
    const freeEvents = allEvents.filter((e) => e.isFreeEvent === true);
    const paidEvents = allEvents.filter((e) => e.isFreeEvent === false);

    const listingPoints = allListings.reduce((s, l) => s + (l.rewardPoints ?? 0), 0);
    const eventPoints = allEvents.reduce((s, e) => s + (e.rewardPoints ?? 0), 0);

    const byCategoryMap = new Map<string, { count: number; rewardTotal: number }>();
    for (const l of allListings) {
      const entry = byCategoryMap.get(l.category) ?? { count: 0, rewardTotal: 0 };
      entry.count += 1;
      entry.rewardTotal += l.rewardPoints ?? 0;
      byCategoryMap.set(l.category, entry);
    }
    const listingsByCategory = Array.from(byCategoryMap.entries())
      .map(([category, v]) => ({
        category,
        count: v.count,
        rewardTotal: v.rewardTotal,
        rewardAvg: v.count > 0 ? Math.round(v.rewardTotal / v.count) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const eventCatMap = new Map<string, number>();
    for (const e of allEvents) {
      eventCatMap.set(e.eventCategory, (eventCatMap.get(e.eventCategory) ?? 0) + 1);
    }
    const eventsByCategory = Array.from(eventCatMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const dataQuality = {
      listingsTotal: allListings.length,
      missingWebsite: allListings.filter((l) => !l.website).length,
      missingPhone: allListings.filter((l) => !l.phone).length,
      missingCoordinates: allListings.filter((l) => l.latitude == null || l.longitude == null).length,
      missingFeaturedImage: allListings.filter((l) => !l.featuredImage).length,
      missingGallery: allListings.filter((l) => !l.galleryImages || l.galleryImages.length === 0).length,
      shortDescription: allListings.filter((l) => (l.description?.length ?? 0) < 80).length,
    };

    let trinidad = 0;
    let tobago = 0;
    let unknown = 0;
    for (const l of allListings) {
      if (l.latitude == null || l.longitude == null) {
        unknown += 1;
      } else if (l.latitude >= 11.0) {
        tobago += 1;
      } else {
        trinidad += 1;
      }
    }

    const topRewardListings = [...allListings]
      .sort((a, b) => (b.rewardPoints ?? 0) - (a.rewardPoints ?? 0))
      .slice(0, 10)
      .map((l) => ({
        id: l.id,
        name: l.name,
        category: l.category,
        rewardPoints: l.rewardPoints ?? 0,
      }));

    const topRewardEvents = [...allEvents]
      .sort((a, b) => (b.rewardPoints ?? 0) - (a.rewardPoints ?? 0))
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        name: e.name,
        eventCategory: e.eventCategory,
        rewardPoints: e.rewardPoints ?? 0,
        startDateTime: e.startDateTime,
      }));

    const monthKey = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

    const months: string[] = [];
    const nowDate = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - i, 1));
      months.push(monthKey(d));
    }

    const listingMonthMap = new Map<string, number>(months.map((m) => [m, 0]));
    for (const l of allListings) {
      if (!l.createdAt) continue;
      const k = monthKey(new Date(l.createdAt));
      if (listingMonthMap.has(k)) listingMonthMap.set(k, (listingMonthMap.get(k) ?? 0) + 1);
    }
    const listingsCreatedByMonth = months.map((m) => ({ month: m, count: listingMonthMap.get(m) ?? 0 }));

    const eventMonthMap = new Map<string, number>(months.map((m) => [m, 0]));
    for (const e of allEvents) {
      if (!e.createdAt) continue;
      const k = monthKey(new Date(e.createdAt));
      if (eventMonthMap.has(k)) eventMonthMap.set(k, (eventMonthMap.get(k) ?? 0) + 1);
    }
    const eventsCreatedByMonth = months.map((m) => ({ month: m, count: eventMonthMap.get(m) ?? 0 }));

    const startOfWeek = (d: Date) => {
      const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = out.getUTCDay();
      out.setUTCDate(out.getUTCDate() - day);
      return out;
    };
    const weekKey = (d: Date) => startOfWeek(d).toISOString().slice(0, 10);

    const weeks: string[] = [];
    const baseWeek = startOfWeek(nowDate);
    for (let i = 0; i < 12; i++) {
      const w = new Date(baseWeek);
      w.setUTCDate(w.getUTCDate() + i * 7);
      weeks.push(w.toISOString().slice(0, 10));
    }
    const weekMap = new Map<string, number>(weeks.map((w) => [w, 0]));
    for (const e of upcomingEvents) {
      const k = weekKey(new Date(e.startDateTime));
      if (weekMap.has(k)) weekMap.set(k, (weekMap.get(k) ?? 0) + 1);
    }
    const upcomingEventsByWeek = weeks.map((w) => ({ weekStart: w, count: weekMap.get(w) ?? 0 }));

    const organizerMap = new Map<string, number>();
    for (const e of allEvents) {
      const name = e.organizerName?.trim();
      if (!name) continue;
      organizerMap.set(name, (organizerMap.get(name) ?? 0) + 1);
    }
    const topOrganizers = Array.from(organizerMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totals: {
        listings: allListings.length,
        events: allEvents.length,
        upcomingEvents: upcomingEvents.length,
        pastEvents: pastEvents.length,
        freeEvents: freeEvents.length,
        paidEvents: paidEvents.length,
        listingRewardPoints: listingPoints,
        eventRewardPoints: eventPoints,
        avgListingRewardPoints: allListings.length > 0 ? Math.round(listingPoints / allListings.length) : 0,
        avgEventRewardPoints: allEvents.length > 0 ? Math.round(eventPoints / allEvents.length) : 0,
      },
      listingsByCategory,
      eventsByCategory,
      dataQuality,
      geographic: { trinidad, tobago, unknown },
      topRewardListings,
      topRewardEvents,
      listingsCreatedByMonth,
      eventsCreatedByMonth,
      upcomingEventsByWeek,
      topOrganizers,
    };
  }
}

export const storage = new DatabaseStorage();
