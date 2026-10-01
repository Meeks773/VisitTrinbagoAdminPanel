/** These namespaces are application policy, not storage-bucket ACL claims. */
export type MediaPurpose = "display" | "original";
export const DISPLAY_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export const ORIGINAL_CONTENT_TYPES = [...DISPLAY_CONTENT_TYPES, "image/tiff", "image/heic", "image/heif"] as const;
export const MAX_DISPLAY_BYTES = 20 * 1024 * 1024;
export const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;

export function mediaKind(path: string): "display" | "original" | "legacy" | null {
  // Reject encodings, separators, traversal and arbitrary keys outside our media
  // namespaces. In particular, do not normalize a private path into a public one.
  const match = /^\/objects\/(uploads|display|originals)\/([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9]+)?)$/.exec(path);
  if (!match || match[2].length > 200) return null;
  return match[1] === "originals" ? "original" : match[1] === "uploads" ? "legacy" : "display";
}

export function mayReadMedia(path: string, admin: boolean, publiclyReferenced: boolean): boolean {
  const kind = mediaKind(path);
  if (!kind) return false;
  if (admin) return true;
  return kind !== "original" && publiclyReferenced;
}