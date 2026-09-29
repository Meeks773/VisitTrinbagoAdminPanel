import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../server/db";
import { importBatches, listings } from "../shared/schema";
import { commitPlaceImport, previewPlaceImport } from "../server/imports/service";
import { storage } from "../server/storage";
import { publicListing } from "../server/publication";
import { validateWorkbookArchive } from "../server/imports/archive-guard";

test("rejects non-workbooks and oversized uploads before parsing", () => {
  assert.throws(() => validateWorkbookArchive(Buffer.from("not an xlsx")), /xlsx/);
  assert.throws(() => validateWorkbookArchive(Buffer.alloc(6 * 1024 * 1024)), /5 MB/);
});

test("same-named branches at different locations are separate drafts", async () => {
  const name = `Branch regression ${crypto.randomUUID()}`;
  let batchId: number | undefined;
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Places");
    sheet.addRow(["Category", "Name", "Location"]);
    sheet.addRow(["eat_drink", name, "North branch"]);
    sheet.addRow(["eat_drink", name, "South branch"]);
    const preview = await previewPlaceImport(Buffer.from(await workbook.xlsx.writeBuffer()), "branches.xlsx");
    batchId = preview.batchId;
    assert.equal(preview.rows.length, 2);
    const result = await commitPlaceImport(batchId, preview.rows.map(row => row.key));
    assert.equal(result.importedCount, 2);
  } finally {
    await db.delete(listings).where(eq(listings.name, name));
    if (batchId) await db.delete(importBatches).where(eq(importBatches.id, batchId));
  }
});

test("draft imports are idempotent, private, and never overwrite published places", async () => {
  const name = `Import regression ${crypto.randomUUID()}`;
  const batches: number[] = [];
  let createdId: number | undefined;
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Places");
    sheet.addRow(["Category", "Name", "Interest", "Sub-Interest", "Description", "Location", "Coordinates"]);
    sheet.addRow(["attractions", name, "Culture", "History", "A complete test description.", "Test location", "10.66, -61.51"]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const preview = await previewPlaceImport(file, "test.xlsx");
    batches.push(preview.batchId);
    assert.equal(preview.rows.length, 1);
    await assert.rejects(commitPlaceImport(preview.batchId, ["not-a-row"]), /not present/);
    const results = await Promise.all([
      commitPlaceImport(preview.batchId, preview.rows.map(row => row.key)),
      commitPlaceImport(preview.batchId, preview.rows.map(row => row.key)),
    ]);
    assert.equal(results[0].importedCount, 1);
    assert.equal(results[1].importedCount, 1);
    assert.equal(results.filter(result => result.alreadyImported).length, 1);
    const [draft] = await db.select().from(listings).where(eq(listings.name, name));
    createdId = draft.id;
    assert.equal(draft.status, "draft");
    assert.equal(draft.importDetails?.batchId, preview.batchId);
    assert.equal(await storage.getPublishedListing(draft.id), undefined);
    assert.equal((await storage.getPublicListings({ search: name })).pagination.total, 0);
    assert.equal((await storage.getPublicListings({ search: name, lat: 10.66, lng: -61.51, radius: 5 })).data.length, 0);
    const counts = await storage.getCategoryCounts();
    await db.update(listings).set({ status: "published" }).where(eq(listings.id, draft.id));
    const publicPlace = await storage.getPublishedListing(draft.id);
    assert.ok(publicPlace);
    assert.ok(!("importDetails" in publicListing(publicPlace)));
    assert.ok(!("importKey" in publicListing(publicPlace)));
    const publicPage = await storage.getPublicListings({ search: name });
    assert.equal(publicPage.pagination.total, 1);
    assert.ok(!("importDetails" in publicPage.data[0]));
    assert.equal((await storage.getCategoryCounts()).attractions, (counts.attractions || 0) + 1);
    const second = await previewPlaceImport(file, "test-reupload.xlsx");
    batches.push(second.batchId);
    assert.equal(second.rows[0].existingId, draft.id);
    const repeat = await commitPlaceImport(second.batchId, second.rows.map(row => row.key));
    assert.equal(repeat.importedCount, 0);
    assert.equal((await storage.getListing(draft.id))?.status, "published");
    await db.update(listings).set({ status: "draft" }).where(eq(listings.id, draft.id));
    assert.equal((await storage.getPublicListings({ search: name })).pagination.total, 0);
  } finally {
    if (createdId) {
      await db.delete(listings).where(and(eq(listings.id, createdId), eq(listings.name, name)));
    }
    for (const id of batches) await db.delete(importBatches).where(eq(importBatches.id, id));
    // Let the connection pool close naturally without keeping node:test alive.
    await db.execute(sql`SELECT 1`);
  }
});