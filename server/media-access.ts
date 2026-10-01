import { and, eq, or, sql } from "drizzle-orm";
import { db } from "./db";
import { events, listings } from "@shared/schema";
import { mediaKind } from "./replit_integrations/object_storage/mediaPolicy";

/** Catalogue publication is authoritative; object custom ACLs cannot make originals public. */
export async function isPublicMediaReference(path: string): Promise<boolean> {
  const kind = mediaKind(path);
  if (!kind || kind === "original") return false;
  const [place] = await db.select({ id: listings.id }).from(listings).where(and(
    eq(listings.status, "published"),
    or(eq(listings.featuredImage, path), sql`${path} = ANY(${listings.galleryImages})`),
  )).limit(1);
  if (place) return true;
  // Events currently have no draft state and are exposed by the public events API.
  const [event] = await db.select({ id: events.id }).from(events).where(or(
    eq(events.featuredImage, path), sql`${path} = ANY(${events.galleryImages})`,
  )).limit(1);
  return !!event;
}