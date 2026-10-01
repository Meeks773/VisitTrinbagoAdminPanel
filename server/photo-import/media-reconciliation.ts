import { photoMediaSchema, safePhotoMedia, type PhotoMedia } from "@shared/photo-media";

/** Keep only importer photos whose card/detail path is still in listing image fields. */
export function reconcilePhotoMedia(
  featuredImage: string | null | undefined,
  galleryImages: string[] | null | undefined,
  value: unknown,
): PhotoMedia | null {
  const media = safePhotoMedia(value);
  if (!media) return null;
  const references = new Set([
    ...(featuredImage ? [featuredImage] : []),
    ...(galleryImages ?? []),
  ]);
  const photos = media.photos.filter((photo) =>
    references.has(photo.card.url) || references.has(photo.detail.url),
  );
  if (!photos.length) return null;
  const cover = photos.find((photo) =>
    featuredImage === photo.detail.url || featuredImage === photo.card.url,
  );
  return photoMediaSchema.parse({
    version: 1,
    coverSha256: cover?.sourceSha256 ?? null,
    photos,
  });
}