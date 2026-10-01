import type { Express } from "express";
import { z } from "zod";
import { isAuthenticatedAdmin, requireAuth } from "../../auth";
import { isPublicMediaReference } from "../../media-access";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import {
  DISPLAY_CONTENT_TYPES, ORIGINAL_CONTENT_TYPES, MAX_DISPLAY_BYTES, MAX_ORIGINAL_BYTES,
  mediaKind, mayReadMedia,
} from "./mediaPolicy";

const uploadRequest = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string(),
  purpose: z.enum(["display", "original"]).default("display"),
}).superRefine((value, ctx) => {
  const types: readonly string[] = value.purpose === "original" ? ORIGINAL_CONTENT_TYPES : DISPLAY_CONTENT_TYPES;
  const maxBytes = value.purpose === "original" ? MAX_ORIGINAL_BYTES : MAX_DISPLAY_BYTES;
  if (!types.includes(value.contentType)) ctx.addIssue({ code: "custom", message: "Unsupported image type" });
  if (value.size > maxBytes) ctx.addIssue({ code: "custom", message: "Image exceeds the size limit" });
});

// Injection permits HTTP-level tests without real storage or database writes.
export function registerObjectStorageRoutes(app: Express, dependencies: {
  storage?: ObjectStorageService;
  isPublicReference?: (path: string) => Promise<boolean>;
} = {}): void {
  const storage = dependencies.storage ?? new ObjectStorageService();
  const isPublicReference = dependencies.isPublicReference ?? isPublicMediaReference;

  app.post("/api/uploads/request-url", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const parsed = uploadRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide a valid image name, size, contentType and purpose (display or original)" });
    try {
      const { name, size, contentType, purpose } = parsed.data;
      const uploadURL = await storage.getObjectEntityUploadURL(purpose);
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath, metadata: { name, size, contentType, purpose } });
    } catch {
      // Signed URLs and storage exception objects can carry credentials.
      console.error("Failed to issue media upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.get(/^\/objects\/(.+)$/, async (req, res) => {
    // A formerly public image must not stay available from a shared cache after
    // unpublishing/removal; even admin previews must never enter a public cache.
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.vary("Cookie");
    const kind = mediaKind(req.path);
    if (!kind) return res.status(404).json({ error: "Object not found" });
    try {
      const admin = isAuthenticatedAdmin(req);
      const referenced = !admin && kind !== "original" ? await isPublicReference(req.path) : false;
      if (!mayReadMedia(req.path, admin, referenced)) return res.status(404).json({ error: "Object not found" });
      const objectFile = await storage.getObjectEntityFile(req.path);
      await storage.downloadObject(objectFile, res, { attachment: kind === "original" });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return res.status(404).json({ error: "Object not found" });
      console.error("Failed to serve media object");
      if (!res.headersSent) return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}