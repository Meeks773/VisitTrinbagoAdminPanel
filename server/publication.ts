import { CATEGORIES, type Listing } from "@shared/schema";
import { reconcilePhotoMedia } from "./photo-import/media-reconciliation";

type PublicationFields = Pick<Listing, "status" | "name" | "category" | "interest" | "subInterest" | "description" | "latitude" | "longitude">;

/** Validate the complete resulting record, not merely the PATCH payload. */
export function publicationErrors(listing: PublicationFields): string[] {
  if (listing.status !== "published") return [];

  const errors: string[] = [];
  for (const field of ["name", "interest", "subInterest", "description"] as const) {
    if (!listing[field]?.trim()) errors.push(`${field} is required to publish`);
  }
  if (!CATEGORIES.includes(listing.category as typeof CATEGORIES[number])) {
    errors.push("A valid category is required to publish");
  }
  const { latitude, longitude } = listing;
  if ((latitude == null) !== (longitude == null)) {
    errors.push("Latitude and longitude must both be provided or both be absent");
  } else if (latitude != null && longitude != null &&
    (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    errors.push("Latitude and longitude must be finite and within valid geographic ranges");
  }
  return errors;
}

/** Explicit allowlist through exclusion of the private import provenance and workflow state. */
export function publicListing(listing: Listing): Omit<Listing, "importKey" | "importDetails" | "status"> {
  const { importKey, importDetails, status, ...visible } = listing;
  return {
    ...visible,
    photoMedia: reconcilePhotoMedia(listing.featuredImage, listing.galleryImages, listing.photoMedia),
  };
}