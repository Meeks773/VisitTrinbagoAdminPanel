import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { DatabasePhotoImportRepository, PhotoImportError, type PhotoImportRepository } from "./repository";
import { PhotoImportService, type PhotoImportObjectStorage } from "./service";

const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i);
const applyBodySchema = z.object({
  reviewToken: uuidSchema,
  confirmation: z.literal("APPLY REVIEWED PHOTO IMPORT"),
}).strict();
const restoreBodySchema = z.object({
  confirmation: z.literal("RESTORE PHOTO IMPORT"),
}).strict();

export function registerPhotoImportRoutes(
  app: Express,
  dependencies: {
    service?: PhotoImportService;
    repository?: PhotoImportRepository;
    storage?: ObjectStorageService;
    objects?: PhotoImportObjectStorage;
  } = {},
): void {
  const router = express.Router();
  router.use(requireAuth);
  const storage = dependencies.storage ?? new ObjectStorageService();
  const objects: PhotoImportObjectStorage = dependencies.objects ?? {
    createStagingUpload: (batchId, fileId, kind) => storage.createPhotoImportStagingUpload(batchId, fileId, kind),
    readPrivateObject: (path, maxBytes) => storage.readPrivateObject(path, maxBytes),
    putImmutablePrivateObject: (path, bytes, contentType) => storage.putImmutablePhotoObject(path, bytes, contentType),
  };
  const service = dependencies.service ?? new PhotoImportService({
    repository: dependencies.repository ?? new DatabasePhotoImportRepository(),
    objects,
  });

  router.get("/", async (_req, res, next) => {
    try {
      res.json({ batches: await service.listBatches() });
    } catch (error) { next(error); }
  });
  router.post("/", async (req, res, next) => {
    try {
      const body = z.object({ name: z.string() }).strict().parse(req.body);
      res.status(201).json({ batch: await service.createBatch(body.name) });
    } catch (error) { next(error); }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid photo import batch id" });
      res.json(await service.getBatchResponse(req.params.id));
    } catch (error) { next(error); }
  });
  router.post("/:id/files", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid photo import batch id" });
      const body = z.object({ files: z.array(z.unknown()) }).strict().parse(req.body);
      res.json({ batch: await service.registerFiles(req.params.id, body.files) });
    } catch (error) { next(error); }
  });
  router.post("/:id/issues", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid photo import batch id" });
      const body = z.object({
        issues: z.array(z.unknown()).max(100),
        sourceTotals: z.unknown().optional(),
      }).strict().parse(req.body);
      res.json({ batch: await service.mergeLocalIssues(req.params.id, body.issues, body.sourceTotals) });
    } catch (error) { next(error); }
  });
  router.post("/:id/files/:fileId/upload-urls", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success || !uuidSchema.safeParse(req.params.fileId).success) {
        return res.status(400).json({ message: "Invalid photo import identifier" });
      }
      const body = z.object({ card: z.unknown(), detail: z.unknown() }).strict().parse(req.body);
      res.json(await service.requestUploadUrls(req.params.id, req.params.fileId, body.card, body.detail));
    } catch (error) { next(error); }
  });
  router.post("/:id/files/:fileId/finalize", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success || !uuidSchema.safeParse(req.params.fileId).success) {
        return res.status(400).json({ message: "Invalid photo import identifier" });
      }
      z.object({}).strict().parse(req.body ?? {});
      res.json({ batch: await service.finalize(req.params.id, req.params.fileId) });
    } catch (error) { next(error); }
  });
  router.post("/:id/review", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid photo import batch id" });
      res.json({ batch: await service.review(req.params.id, req.body) });
    } catch (error) { next(error); }
  });
  router.post("/:id/apply", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid photo import batch id" });
      const body = applyBodySchema.parse(req.body);
      res.json({ batch: await service.apply(req.params.id, body.reviewToken, body.confirmation) });
    } catch (error) { next(error); }
  });
  router.post("/:id/restore", async (req, res, next) => {
    try {
      if (!uuidSchema.safeParse(req.params.id).success) return res.status(400).json({ message: "Invalid photo import batch id" });
      const body = restoreBodySchema.parse(req.body);
      res.json({ batch: await service.restore(req.params.id, body.confirmation) });
    } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof PhotoImportError) return res.status(error.status).json({ message: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ message: "Request does not match the photo import contract" });
    // Storage errors can contain signed URLs, bucket/object details or private
    // provider metadata. Keep responses generic and never log exception text.
    console.error("Photo import request failed");
    return res.status(500).json({ message: "Photo import request failed" });
  });
  app.use("/api/photo-imports", router);
}