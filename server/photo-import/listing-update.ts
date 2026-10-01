import { z } from "zod";
import type { InsertListing, Listing } from "@shared/schema";
import { photoMediaSchema } from "@shared/photo-media";
import type { MediaSnapshot } from "@shared/photo-import-types";
import { listingPhotoWriteError, reconcileListingPhotoPatch } from "./listing-write-validation";
import { reconcilePhotoMedia } from "./media-reconciliation";

export const expectedMediaSnapshotSchema = z.object({
  featuredImage: z.string().max(2048).nullable(),
  galleryImages: z.array(z.string().max(2048)).max(2500).nullable(),
  photoMedia: photoMediaSchema.nullable(),
}).strict();

export type ExpectedMediaSnapshot = MediaSnapshot;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(listing: Listing): MediaSnapshot {
  return {
    featuredImage: listing.featuredImage,
    galleryImages: listing.galleryImages ? [...listing.galleryImages] : null,
    photoMedia: reconcilePhotoMedia(listing.featuredImage, listing.galleryImages, listing.photoMedia),
  };
}

function changesPhotoFields(payload: Partial<InsertListing>, current: Listing): boolean {
  const currentSnapshot = snapshot(current);
  const desired = {
    featuredImage: Object.prototype.hasOwnProperty.call(payload, "featuredImage") ? payload.featuredImage : currentSnapshot.featuredImage,
    galleryImages: Object.prototype.hasOwnProperty.call(payload, "galleryImages") ? payload.galleryImages : currentSnapshot.galleryImages,
    photoMedia: Object.prototype.hasOwnProperty.call(payload, "photoMedia") ? payload.photoMedia : currentSnapshot.photoMedia,
  };
  return canonical(desired) !== canonical(currentSnapshot);
}

export type GuardedListingPatch =
  | { ok: true; data: Partial<InsertListing> }
  | { ok: false; status: 400 | 409 | 428; message: string };

/**
 * Called only with a listing row selected FOR UPDATE. A missing/old editor
 * snapshot cannot overwrite photos changed by an import or another editor.
 */
export function prepareGuardedListingPatch(
  payload: Partial<InsertListing>,
  current: Listing,
  expectedMedia?: ExpectedMediaSnapshot,
): GuardedListingPatch {
  if (changesPhotoFields(payload, current)) {
    if (!expectedMedia) {
      return {
        ok: false,
        status: 428,
        message: "Photo fields changed. Refresh the listing and submit its expectedMedia snapshot.",
      };
    }
    if (canonical(expectedMedia) !== canonical(snapshot(current))) {
      return {
        ok: false,
        status: 409,
        message: "Listing photo fields changed since this editor loaded. Refresh before saving.",
      };
    }
  }
  const photoError = listingPhotoWriteError(payload, current);
  if (photoError) return { ok: false, status: 400, message: photoError };
  return {
    ok: true,
    data: reconcileListingPhotoPatch(payload, current),
  };
}