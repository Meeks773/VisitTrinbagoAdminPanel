import { isVersionedPhotoDisplayPath, safePhotoMedia } from "@shared/photo-media";
import type { Listing } from "@shared/schema";
import { mediaKind } from "../replit_integrations/object_storage/mediaPolicy";
import { reconcilePhotoMedia } from "./media-reconciliation";
import type { InsertListing } from "@shared/schema";

type ListingPhotoWrite = {
  photoMedia?: unknown;
  featuredImage?: unknown;
  galleryImages?: unknown;
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateReference(value: unknown, existing: Listing | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 2048 || !value.trim()) return "Image references must be nonempty strings no longer than 2,048 characters";
  if (value.startsWith("/objects/")) {
    const kind = mediaKind(value);
    if (!kind || kind === "original") return "Private or malformed media paths cannot be listed";
    if (value.startsWith("/objects/display/photo-imports/") && !isVersionedPhotoDisplayPath(value)) {
      return "Malformed versioned photo-import media paths cannot be listed";
    }
    if (isVersionedPhotoDisplayPath(value)) {
      const media = existing
        ? reconcilePhotoMedia(existing.featuredImage, existing.galleryImages, existing.photoMedia)
        : null;
      if (!media?.photos.some((photo) => photo.card.url === value || photo.detail.url === value)) {
        return "Versioned photo-import media can only be selected from the listing's validated photo media";
      }
    }
    return null;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return "Image URLs must use HTTP or HTTPS";
    }
    return null;
  } catch {
    return "Image references must be a supported media path or HTTP(S) URL";
  }
}

/**
 * Regular listing forms can preserve importer-managed fields, but cannot set or
 * rewrite them. This prevents stale forms from erasing reviewed media and
 * prevents an editor payload from manufacturing a public import catalogue.
 */
export function listingPhotoWriteError(
  payload: ListingPhotoWrite,
  existing?: Listing,
): string | null {
  if (Object.prototype.hasOwnProperty.call(payload, "photoMedia")) {
    const submitted = payload.photoMedia;
    const parsed = submitted === null ? null : safePhotoMedia(submitted);
    if (submitted !== null && !parsed) return "photoMedia must be valid versioned public display media";
    const current = existing
      ? reconcilePhotoMedia(existing.featuredImage, existing.galleryImages, existing.photoMedia)
      : null;
    if (!existing) {
      if (parsed) return "photoMedia can only be set by a finalized, reviewed photo import";
    } else if (!sameJson(parsed, current)) {
      return "photoMedia is managed by reviewed photo imports and must not be changed by the listing editor";
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "featuredImage")) {
    const error = validateReference(payload.featuredImage, existing);
    if (error) return error;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "galleryImages")) {
    const gallery = payload.galleryImages;
    if (gallery !== null && (!Array.isArray(gallery) || gallery.length > 50)) {
      return "Gallery images must contain at most 50 references";
    }
    if (Array.isArray(gallery)) {
      for (const reference of gallery) {
        const error = validateReference(reference, existing);
        if (error) return error;
      }
    }
  }
  return null;
}

/**
 * A legacy listing editor owns featured/gallery refs, not the import catalogue.
 * Recompute importer metadata from the effective image fields on every ordinary
 * image-field patch so removed photos immediately lose public authorization.
 */
export function reconcileListingPhotoPatch(
  payload: Partial<InsertListing>,
  existing: Listing,
): Partial<InsertListing> {
  const featureChanged = Object.prototype.hasOwnProperty.call(payload, "featuredImage");
  const galleryChanged = Object.prototype.hasOwnProperty.call(payload, "galleryImages");
  if (!featureChanged && !galleryChanged) return payload;
  const featuredImage = featureChanged ? payload.featuredImage : existing.featuredImage;
  const galleryImages = galleryChanged ? payload.galleryImages : existing.galleryImages;
  return {
    ...payload,
    photoMedia: reconcilePhotoMedia(featuredImage, galleryImages, existing.photoMedia),
  };
}