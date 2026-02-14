import { type Listing, type InsertListing, listings } from "@shared/schema";
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

export interface IStorage {
  getListings(category?: string): Promise<Listing[]>;
  getListing(id: number): Promise<Listing | undefined>;
  createListing(data: InsertListing): Promise<Listing>;
  updateListing(id: number, data: Partial<InsertListing>): Promise<Listing | undefined>;
  deleteListing(id: number): Promise<boolean>;
  getPublicListings(options: PublicQueryOptions): Promise<PaginatedResult<Listing>>;
  getCategoryCounts(): Promise<Record<string, number>>;
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
}

export const storage = new DatabaseStorage();
