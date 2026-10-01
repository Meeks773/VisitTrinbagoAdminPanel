import { and, eq, or, sql } from "drizzle-orm";
import { db } from "./db";
import { events, listings } from "@shared/schema";
import { mediaKind } from "./replit_integrations/object_storage/mediaPolicy";
import { isVersionedPhotoDisplayPath } from "@shared/photo-media";
import { reconcilePhotoMedia } from "./photo-import/media-reconciliation";

/** Catalogue publication is authoritative; object custom ACLs cannot make originals public. */
export async function isPublicMediaReference(path: string): Promise<boolean> {
  const kind = mediaKind(path);
  if (!kind || kind === "original") return false;
  if (path.startsWith("/objects/display/photo-imports/") && !isVersionedPhotoDisplayPath(path)) return false;
  if (isVersionedPhotoDisplayPath(path)) {
    const candidates = await db.select({
      photoMedia: listings.photoMedia,
      featuredImage: listings.featuredImage,
      galleryImages: listings.galleryImages,
    })
      .from(listings).where(and(eq(listings.status, "published"), sql`
        ${listings.photoMedia} @> jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('card', jsonb_build_object('url', ${path}))))
        OR ${listings.photoMedia} @> jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('detail', jsonb_build_object('url', ${path}))))
      `));
    return candidates.some(({ photoMedia, featuredImage, galleryImages }) =>
      reconcilePhotoMedia(featuredImage, galleryImages, photoMedia)
        ?.photos.some((photo) => photo.card.url === path || photo.detail.url === path),
    );
  }
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