import { type Listing, type InsertListing, listings } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  getListings(category?: string): Promise<Listing[]>;
  getListing(id: number): Promise<Listing | undefined>;
  createListing(data: InsertListing): Promise<Listing>;
  updateListing(id: number, data: Partial<InsertListing>): Promise<Listing | undefined>;
  deleteListing(id: number): Promise<boolean>;
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
    const [listing] = await db.insert(listings).values(data).returning();
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
}

export const storage = new DatabaseStorage();
