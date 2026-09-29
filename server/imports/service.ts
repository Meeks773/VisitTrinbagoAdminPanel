import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { importBatches, listings } from "@shared/schema";
import type { ImportCommitResponse, ImportPreviewResponse, PlaceImportPreview, PlaceImportRow } from "@shared/import-types";
import { parsePlaceWorkbook } from "./parser";
import { validateWorkbookArchive } from "./archive-guard";

export class ImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function normalizePlaceName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type ExistingPlace = {
  id: number; name: string; category: string; importKey: string | null;
  location: string | null; latitude: number | null; longitude: number | null;
};

function findExisting(row: PlaceImportRow, existing: ExistingPlace[]) {
  return existing.find(place => {
    if (place.importKey === row.key) return true;
    if (place.category !== row.data.category || normalizePlaceName(place.name) !== normalizePlaceName(row.data.name)) return false;
    const sameAddress = !!place.location && !!row.data.location &&
      normalizePlaceName(place.location) === normalizePlaceName(row.data.location);
    const sameCoordinates = place.latitude != null && place.longitude != null &&
      row.data.latitude != null && row.data.longitude != null &&
      Math.abs(place.latitude - row.data.latitude) < 0.0002 &&
      Math.abs(place.longitude - row.data.longitude) < 0.0002;
    return sameAddress || sameCoordinates;
  });
}

export async function previewPlaceImport(buffer: Buffer, fileName: string): Promise<ImportPreviewResponse> {
  validateWorkbookArchive(buffer);
  const preview = await parsePlaceWorkbook(buffer, fileName);
  const existing = await db.select({
    id: listings.id, name: listings.name, category: listings.category, importKey: listings.importKey,
    location: listings.location, latitude: listings.latitude, longitude: listings.longitude,
  }).from(listings);
  for (const row of preview.rows) {
    const match = findExisting(row, existing);
    if (match) {
      row.existingId = match.id;
      row.warnings.push("This place already exists at the same location or was imported before. Skipped to avoid changing existing content.");
    } else if (existing.some(place => normalizePlaceName(place.name) === normalizePlaceName(row.data.name))) {
      row.warnings.push("A similarly named place exists at another location or in another category. Review whether both listings are needed.");
    }
  }
  const [batch] = await db.insert(importBatches).values({ fileName, preview }).returning({ id: importBatches.id });
  return { ...preview, batchId: batch.id };
}

export async function commitPlaceImport(batchId: number, keys: string[]): Promise<ImportCommitResponse> {
  if (!keys.length) throw new ImportError("Select at least one new place to import.");
  return db.transaction(async tx => {
    // Serialize imports across instances and recheck identities at commit time.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(870123401)`);
    const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
    if (!batch) throw new ImportError("Import preview not found. Upload the workbook again.", 404);
    if (batch.status === "imported") {
      return { batchId, importedCount: batch.importedCount, skippedCount: batch.skippedCount, alreadyImported: true };
    }
    const preview = batch.preview as PlaceImportPreview;
    const selection = new Set(keys);
    const known = new Set(preview.rows.map(row => row.key));
    if (keys.some(key => !known.has(key))) throw new ImportError("Selection contains rows not present in this preview.");
    const candidates = preview.rows.filter(row => selection.has(row.key));
    const existing = await tx.select({
      id: listings.id, name: listings.name, category: listings.category, importKey: listings.importKey,
      location: listings.location, latitude: listings.latitude, longitude: listings.longitude,
    }).from(listings);
    let importedCount = 0;
    let skippedCount = preview.skipped.length + preview.rows.length - candidates.length;
    for (const row of candidates) {
      if (findExisting(row, existing)) {
        skippedCount++;
        continue;
      }
      const [created] = await tx.insert(listings).values({
        ...row.data,
        status: "draft",
        importKey: row.key,
        importDetails: {
          batchId, fileName: batch.fileName, sheet: row.sheet, rowNumber: row.rowNumber,
          verified: row.verified, warnings: row.warnings, rawColumns: row.rawColumns,
        },
      }).onConflictDoNothing().returning({
        id: listings.id, name: listings.name, category: listings.category, importKey: listings.importKey,
        location: listings.location, latitude: listings.latitude, longitude: listings.longitude,
      });
      if (created) {
        importedCount++;
        existing.push(created);
      } else skippedCount++;
    }
    await tx.update(importBatches).set({
      status: "imported", importedCount, skippedCount,
    }).where(and(eq(importBatches.id, batchId), eq(importBatches.status, "previewed")));
    return { batchId, importedCount, skippedCount };
  });
}

export async function listImportBatches() {
  return db.select({
    id: importBatches.id,
    fileName: importBatches.fileName,
    status: importBatches.status,
    createdAt: importBatches.createdAt,
    importedCount: importBatches.importedCount,
    skippedCount: importBatches.skippedCount,
  }).from(importBatches).orderBy(desc(importBatches.createdAt)).limit(50);
}