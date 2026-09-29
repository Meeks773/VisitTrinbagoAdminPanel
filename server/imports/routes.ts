import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { createPlaceTemplate } from "./parser";
import { commitPlaceImport, ImportError, listImportBatches, previewPlaceImport } from "./service";
import { MAX_UPLOAD_BYTES } from "./archive-guard";

const spreadsheetMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function registerImportRoutes(app: Express) {
  const router = express.Router();
  router.use(requireAuth);
  router.get("/", async (_req, res, next) => {
    try { res.json(await listImportBatches()); } catch (error) { next(error); }
  });
  router.get("/template", async (_req, res, next) => {
    try {
      res.type(spreadsheetMime)
        .attachment("visittrinbago-places-template.xlsx")
        .send(await createPlaceTemplate());
    } catch (error) { next(error); }
  });
  router.post("/preview", express.raw({ type: spreadsheetMime, limit: MAX_UPLOAD_BYTES }), async (req, res, next) => {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({ message: "Upload an Excel .xlsx file using the workbook content type." });
    }
    let fileName: string;
    try {
      fileName = decodeURIComponent(req.get("X-File-Name") || "places.xlsx").split(/[\\/]/).pop()!.slice(0, 200);
    } catch {
      return res.status(400).json({ message: "Invalid file name." });
    }
    if (!/\.xlsx$/i.test(fileName)) return res.status(400).json({ message: "Only .xlsx workbooks are supported." });
    try {
      res.json(await previewPlaceImport(req.body, fileName));
    } catch (error) {
      // Parser errors describe invalid files; database errors still fail explicitly.
      if (error instanceof Error && !("query" in error) && !("severity" in error)) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  router.post("/:id/commit", async (req, res, next) => {
    const id = Number(req.params.id);
    const selection = z.object({ keys: z.array(z.string().min(1).max(300)).min(1).max(2500) }).safeParse(req.body);
    if (!Number.isSafeInteger(id) || id < 1 || !selection.success) {
      return res.status(400).json({ message: "Choose a valid preview and at least one row to import." });
    }
    try {
      res.json(await commitPlaceImport(id, selection.data.keys));
    } catch (error) { next(error); }
  });
  router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error.type === "entity.too.large") return res.status(413).json({ message: "Workbook exceeds the 5 MB upload limit." });
    if (error instanceof ImportError) return res.status(error.status).json({ message: error.message });
    next(error);
  });
  app.use("/api/imports", router);
}