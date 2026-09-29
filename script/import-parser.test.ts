import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { createPlaceTemplate, parsePlaceWorkbook } from "../server/imports/parser";

async function fixture(sheets: Record<string, string[][]>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(name);
    rows.forEach(row => sheet.addRow(row));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function main() {
  const standard = await fixture({
    Places: [
      ["Category", "Name", "Interest", "Sub-Interest", "Description", "Location", "Coordinates", "Website", "Phone", "Email"],
      ["Beaches", "  Blue  Bay ", "", "", "", "West End", "10.5, -61.2", "www.example.com/visit", "868-123-4567", "hello@example.com"],
      ["beaches", "Blue Bay", "", "", "", " West  End ", "91, 120", "javascript:alert(1)", "", ""],
      ["invalid", "Mystery", "", "", "", "", "", "", "", ""],
      ["Nightlife", "Blue Bay", "", "", "", "", "", "", "", ""],
      ["", "Text", "", "", "", "", "", "", "", ""],
    ],
    "Specials Verified": [["Name of Special/Offer"], ["2-for-1 cocktails"]],
    "Categories Reference": [["Category"], ["Attractions"]],
    Events: [["Name of Event"]],
  });
  const result = await parsePlaceWorkbook(standard, "standard.xlsx");
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].data.category, "beaches");
  assert.equal(result.rows[0].data.interest, "");
  assert.equal(result.rows[0].data.description, "");
  assert.equal(result.rows[0].data.website, "https://www.example.com/visit");
  assert.deepEqual([result.rows[0].data.latitude, result.rows[0].data.longitude], [10.5, -61.2]);
  assert.ok(result.rows[0].warnings.some(w => w.includes("Interest missing")));
  assert.ok(result.rows[0].warnings.some(w => w.includes("cross-category")));
  assert.ok(result.skipped.some(s => s.name === "Mystery"));
  assert.ok(result.skipped.some(s => s.name === "2-for-1 cocktails"));
  assert.equal(result.sheets.find(s => s.name === "Events")?.rows, 0);
  assert.deepEqual(result.rows.map(r => r.key), (await parsePlaceWorkbook(standard, "again.xlsx")).rows.map(r => r.key));

  const ttl = await fixture({
    "Sites and Attractions": [
      ["Name", "Category", "Interest", "Sub-Interest", "Description", "Location", "Entry Fee", "Images", "Website/Booking Link", "Coordinates", "STAFF COMMENTS", "Verified by: (Staff Initial)", "Accessibility Features"],
      ["Museum", "Museums", "Art", "", "old description", "Old address", "TT$30 and US$10", "Uploaded to folder", "www.museum.org", "10.1, -61.5", "Called Lisa; follow up", "AB", "Wheelchair access"],
    ],
    "Sites and Attractions Verified": [
      ["Name", "Category", "Interest", "Sub-Interest", "Description", "Location", "Entry Fee", "Images", "Website/Booking Link", "Coordinates", "Comments", "Verified by: (Staff Initial)", "Accessibility Features"],
      ["Museum", "Museums", "Art", "Gallery", "verified description", "New address", "TT$30 and US$10", "Awaiting image", "https://museum.org", "10.2, -61.4", "Called Jane", "CD", "Ramp"],
    ],
    Tours: [
      ["Name of Stakeholder", "Name of Tour", "Description", "Contact Information Name", "Comments"],
      ["Tour Provider", "Rainforest Walk", "Walk", "Staff Contact", "Emailed the team"],
      ["Other Provider", "", "", "Other Contact", "Follow up"],
    ],
    Nature: [
      ["Name", "Amenities", "Images"],
      ["Nature Park", "Guided hikes, bird watching;Restrooms\nParking", "Uploaded"],
    ],
    Business: [
      ["Name", "Features"],
      ["Conference Hall", "Capacity 100, seated;Projector\nWi-Fi"],
    ],
    "Food & Drink": [
      ["Name", "Special Features"],
      ["Café", "Outdoor seating, covered;Pet friendly"],
    ],
  });
  const merged = await parsePlaceWorkbook(ttl, "ttl.xlsx");
  assert.equal(merged.rows.length, 6);
  assert.equal(merged.rows[0].data.description, "verified description");
  assert.equal(merged.rows[0].data.location, "New address");
  assert.equal(merged.rows[0].verified, true);
  assert.equal(merged.rows[0].data.featuredImage, null);
  assert.equal(merged.rows[0].data.metadata.priceNotes, "TT$30 and US$10");
  assert.equal(merged.rows[0].data.metadata.accessibility, "Ramp");
  assert.equal(merged.rows[0].data.metadata.subtype, "Museums");
  assert.ok(merged.rows[0].warnings.some(w => w.includes("Sub-interest missing")));
  assert.ok(merged.rows[0].warnings.some(w => w.includes("location differs")));
  assert.ok(merged.skipped.some(s => s.reason.includes("Superseded")));
  assert.equal(merged.rows[1].data.name, "Rainforest Walk");
  assert.equal(merged.rows[1].data.metadata.provider, "Tour Provider");
  assert.equal(merged.rows[2].data.name, "Other Provider");
  assert.ok(merged.rows[2].warnings.some(w => w.includes("Tour name missing")));
  assert.deepEqual(merged.rows[3].data.metadata.amenities, ["Guided hikes, bird watching", "Restrooms", "Parking"]);
  assert.deepEqual(merged.rows[4].data.metadata.specialFeatures, ["Capacity 100, seated", "Projector", "Wi-Fi"]);
  assert.deepEqual(merged.rows[5].data.metadata.amenities, ["Outdoor seating, covered", "Pet friendly"]);
  for (const row of merged.rows) {
    for (const key of ["amenities", "specialFeatures", "videoUrls", "specialNights"]) {
      if (key in row.data.metadata) assert.ok(Array.isArray(row.data.metadata[key]), `${row.sheet} ${key} should be an array`);
    }
  }
  for (const row of merged.rows) {
    const publicData = JSON.stringify(row.data);
    assert.doesNotMatch(publicData, /Called Lisa|Called Jane|Emailed the team|Staff Contact|Other Contact|"AB"|"CD"/);
  }
  assert.equal(merged.rows[0].rawColumns.Comments, "Called Jane");

  const template = await createPlaceTemplate();
  const templatePreview = await parsePlaceWorkbook(template, "template.xlsx");
  assert.equal(templatePreview.rows.length, 0);
  assert.equal(templatePreview.sheets[0].name, "Places");
  await assert.rejects(() => parsePlaceWorkbook(Buffer.alloc(5 * 1024 * 1024 + 1), "oversized.xlsx"), /5 MB/);
  await assert.rejects(() => parsePlaceWorkbook(Buffer.from("not an xlsx"), "invalid.xlsx"), /valid XLSX/);
  const oversizedXml = Buffer.from(template);
  const central = oversizedXml.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0);
  oversizedXml.writeUInt32LE(41 * 1024 * 1024, central + 24);
  await assert.rejects(() => parsePlaceWorkbook(oversizedXml, "xml-bomb.xlsx"), /XML exceeds/);
  const tooMany = new ExcelJS.Workbook();
  const crowded = tooMany.addWorksheet("Places");
  crowded.addRow(["Category", "Name"]);
  for (let n = 1; n <= 2501; n++) crowded.addRow(["beaches", `Beach ${n}`]);
  const crowdedBuffer = Buffer.from(await tooMany.xlsx.writeBuffer());
  await assert.rejects(
    () => parsePlaceWorkbook(crowdedBuffer, "too-many.xlsx"),
    /2,500 candidate/,
  );

  const real = await readFile("attached_assets/New_Destination_App_2026_(-_TTL_Submission_1790695285034.xlsx");
  const preview = await parsePlaceWorkbook(real, "New_Destination_App_2026.xlsx");
  const original = preview.sheets.find(s => s.name === "Sites and Attractions");
  const verified = preview.sheets.find(s => s.name === "Sites and Attractions Verified");
  assert.ok(original && verified);
  assert.ok(verified.rows >= 20);
  assert.ok(preview.skipped.filter(s => s.reason.includes("Superseded")).length >= 20);
  assert.equal(preview.sheets.find(s => s.name === "Events")?.rows, 0);
  assert.ok(preview.skipped.some(s => s.sheet === "Specials"));
  assert.ok(preview.skipped.some(s => s.sheet === "Specials Verified"));
  assert.ok(preview.rows.some(r => r.data.category === "transport"));
  assert.ok(preview.rows.some(r => r.data.category === "eat_drink"));
  assert.ok(preview.rows.some(r => r.data.category === "attractions" && r.sheet === "Nature"));
  assert.ok(preview.rows.every(r => !JSON.stringify(r.data.metadata).includes("Verified by:")));
  const tagKeys = ["amenities", "specialFeatures", "videoUrls", "specialNights"];
  for (const row of preview.rows) {
    for (const key of tagKeys) {
      if (key in row.data.metadata) {
        assert.ok(Array.isArray(row.data.metadata[key]), `${row.sheet} row ${row.rowNumber}: ${key} must be an array`);
        assert.ok((row.data.metadata[key] as unknown[]).every(item => typeof item === "string"), `${key} must contain strings`);
      }
    }
  }
  const repeated = await parsePlaceWorkbook(real, "same-content.xlsx");
  assert.deepEqual(preview.rows.map(r => r.key), repeated.rows.map(r => r.key));
  console.log("Parser tests passed", {
    rows: preview.rows.length,
    skipped: preview.skipped.length,
    verifiedOverrides: preview.skipped.filter(s => s.reason.includes("Superseded")).length,
    sheets: Object.fromEntries(preview.sheets.map(s => [s.name, s.rows])),
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });