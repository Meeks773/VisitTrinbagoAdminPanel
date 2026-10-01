import { z } from "zod";

export interface PhotoVariant {
  url: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  format: "webp" | "jpeg";
}

export interface PublicPlacePhoto {
  sourceSha256: string;
  card: PhotoVariant;
  detail: PhotoVariant;
}

/** Only public display copies belong here. Never include private original paths. */
export interface PhotoMedia {
  version: 1;
  coverSha256: string | null;
  photos: PublicPlacePhoto[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const VERSIONED_DISPLAY_PATH =
  /^\/objects\/display\/photo-imports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/([a-f0-9]{64})\.(webp|jpg)$/;

export function isVersionedPhotoDisplayPath(path: string): boolean {
  return VERSIONED_DISPLAY_PATH.test(path);
}

export const photoVariantSchema = z.object({
  url: z.string().max(256),
  sha256: z.string().regex(SHA256),
  bytes: z.number().int().positive().max(20 * 1024 * 1024),
  width: z.number().int().positive().max(1600),
  height: z.number().int().positive().max(1600),
  format: z.enum(["webp", "jpeg"]),
}).superRefine((variant, ctx) => {
  const path = VERSIONED_DISPLAY_PATH.exec(variant.url);
  if (!path || path[1] !== variant.sha256 || path[2] !== (variant.format === "jpeg" ? "jpg" : "webp")) {
    ctx.addIssue({ code: "custom", path: ["url"], message: "Photo variants must reference an immutable versioned display object" });
  }
  if (variant.width * variant.height > 40_000_000) {
    ctx.addIssue({ code: "custom", path: ["width"], message: "Photo dimensions exceed the supported pixel limit" });
  }
});

const publicPlacePhotoSchema = z.object({
  sourceSha256: z.string().regex(SHA256),
  card: photoVariantSchema.refine((variant) => Math.max(variant.width, variant.height) <= 640, {
    message: "Card photos must fit within 640 pixels",
  }),
  detail: photoVariantSchema,
});

export const photoMediaSchema = z.object({
  version: z.literal(1),
  coverSha256: z.string().regex(SHA256).nullable(),
  photos: z.array(publicPlacePhotoSchema).max(2500),
}).superRefine((media, ctx) => {
  const hashes = new Set<string>();
  for (const [index, photo] of media.photos.entries()) {
    if (hashes.has(photo.sourceSha256)) {
      ctx.addIssue({ code: "custom", path: ["photos", index, "sourceSha256"], message: "Duplicate photo source hash" });
    }
    hashes.add(photo.sourceSha256);
  }
  if (media.coverSha256 && !hashes.has(media.coverSha256)) {
    ctx.addIssue({ code: "custom", path: ["coverSha256"], message: "Cover hash must refer to a photo in this listing" });
  }
});

/** Use at database/public boundaries; invalid historical JSON is never projected. */
export function safePhotoMedia(value: unknown): PhotoMedia | null {
  const parsed = photoMediaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}