import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { Category } from "../../shared/schema";
import type { PlaceImportPreview, PlaceImportRow } from "../../shared/import-types";

const MAX_FILE = 5 * 1024 * 1024;
const MAX_XML = 40 * 1024 * 1024;
const MAX_ROWS = 2500;
const MAX_COLUMNS = 64;

const sheetCategories: Record<string, Category> = {
  "sites and attractions": "attractions",
  "sites and attractions verified": "attractions",
  nature: "attractions",
  "food drink": "eat_drink",
  "getting around": "transport",
  nightlife: "nightlife",
  beaches: "beaches",
  wellness: "wellness",
  shopping: "shopping",
  stay: "stay",
  business: "business",
  tours: "tours",
  festivals: "festivals",
};

const aliases: Record<string, Category> = {
  ...sheetCategories,
  attractions: "attractions",
  attraction: "attractions",
  "eat drink": "eat_drink",
  "eat and drink": "eat_drink",
  "food and drink": "eat_drink",
  transport: "transport",
  "transportation": "transport",
};

function norm(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function header(value: string): string {
  return norm(value).replace(/\s+/g, "");
}

function value(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Merge && cell.master !== cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map(p => p.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    if ("result" in v) return v.result == null ? "" : String(v.result).trim();
    return "";
  }
  return String(v).trim();
}

function link(cell: ExcelJS.Cell): string {
  const v = cell.value;
  // A hyperlink's label can be "Facebook", while its target is the actual URL.
  if (v && typeof v === "object" && "hyperlink" in v && /^https?:\/\//i.test(v.hyperlink)) return v.hyperlink;
  return value(cell);
}

function url(raw: string): string | null {
  const match = raw.match(/(?:https?:\/\/|www\.)[^\s<>"'，]+/i);
  if (!match) return null;
  try {
    const parsed = new URL(/^www\./i.test(match[0]) ? `https://${match[0]}` : match[0]);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".") || /\s/.test(parsed.hostname)) return null;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

function coords(raw: string): [number | null, number | null] {
  const numbers = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (!numbers) return [null, null];
  const lat = Number(numbers[1]), lon = Number(numbers[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : [null, null];
}

function tags(raw: string): string[] {
  // Commas also occur inside descriptive notes; don't guess at their meaning.
  return raw.split(/[;\r\n]+/).map(item => item.trim()).filter(Boolean);
}

function identity(category: Category, name: string, location: string | null): string {
  return createHash("sha256").update(JSON.stringify([category, norm(name), norm(location ?? "")])).digest("hex");
}

// Check the ZIP central directory before ExcelJS inflates workbook XML. In particular,
// a small compressed upload must not be able to expand into an enormous worksheet.
function checkArchive(buffer: Buffer): void {
  if (buffer.length > MAX_FILE) throw new Error("Workbook exceeds the 5 MB upload limit.");
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error("A valid XLSX file is required.");
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Invalid XLSX archive.");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), total = 0;
  if (count > 2000) throw new Error("Workbook has too many archive entries.");
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid XLSX archive directory.");
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (size === 0xffffffff) throw new Error("ZIP64 workbooks are not supported.");
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      total += size;
      if (size > MAX_XML || total > MAX_XML) throw new Error("Workbook XML exceeds the 40 MB safety limit.");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

export async function parsePlaceWorkbook(buffer: Buffer, fileName: string): Promise<PlaceImportPreview> {
  checkArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const preview: PlaceImportPreview = { fileName, rows: [], sheets: [], skipped: [], notices: [] };
  const keys = new Map<string, number>();
  const names = new Map<string, number[]>();
  let candidates = 0;

  for (const sheet of workbook.worksheets) {
    const sheetName = norm(sheet.name);
    const standard = sheetName === "places";
    const category = standard ? null : sheetCategories[sheetName] ?? null;
    const record: PlaceImportPreview["sheets"][number] = { name: sheet.name, category, rows: 0 };
    preview.sheets.push(record);
    if (sheetName.startsWith("specials")) {
      record.reason = "Offers are not places; excluded from place import.";
      preview.notices.push(`${sheet.name}: offers excluded from place import.`);
      const offerHeader = sheet.getRow(1);
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        const name = value(sheet.getRow(rowNumber).getCell(1));
        if (name && norm(name) !== "text" && !norm(name).startsWith("name of special")) {
          preview.skipped.push({ sheet: sheet.name, rowNumber, name, reason: record.reason });
        }
      }
      continue;
    }
    if (!standard && !category) {
      record.reason = sheetName === "events" ? "Events are not place listings." : "Reference or unsupported sheet.";
      preview.notices.push(`${sheet.name}: ${record.reason}`);
      continue;
    }
    if (sheet.rowCount > 10000) throw new Error(`Sheet ${sheet.name} exceeds the row safety limit.`);
    const first = sheet.getRow(1);
    const columns = Math.min(first.cellCount, MAX_COLUMNS);
    const headers = Array.from({ length: columns }, (_, i) => value(first.getCell(i + 1)));
    const indexed = headers.map(header);
    const find = (...wanted: string[]): number => indexed.findIndex(h => wanted.some(w => h === header(w))) + 1;
    const nameCol = standard ? find("Name") : sheetName === "tours" ? find("Name of Tour") : find("Name", "Venue Name");
    const providerCol = find("Name of Stakeholder");
    if (!nameCol && !providerCol) {
      record.reason = "No supported name column.";
      preview.notices.push(`${sheet.name}: ${record.reason}`);
      continue;
    }
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const read = (...wanted: string[]): string => {
        const column = find(...wanted);
        return column ? value(row.getCell(column)) : "";
      };
      const readLink = (...wanted: string[]): string => {
        const column = find(...wanted);
        return column ? link(row.getCell(column)) : "";
      };
      const provider = read("Name of Stakeholder");
      let name = read("Name", "Venue Name", "Name of Tour");
      if (!name && sheetName === "tours") name = provider;
      if (!name) continue;
      const normalized = norm(name);
      if (/^(text|name|venue name|name of tour|url|n a|na)$/.test(normalized) || /^url if available/.test(normalized)) continue;
      if (++candidates > MAX_ROWS) throw new Error("Workbook exceeds the 2,500 candidate place limit.");
      const rawColumns: Record<string, string> = {};
      for (let c = 1; c <= columns; c++) {
        const raw = value(row.getCell(c));
        if (!raw) continue;
        const title = headers[c - 1] || `Column ${c}`;
        rawColumns[rawColumns[title] === undefined ? title : `${title} (${c})`] = raw;
      }
      let rowCategory = category;
      if (standard) rowCategory = aliases[norm(read("Category"))] ?? null;
      if (!rowCategory) {
        preview.skipped.push({ sheet: sheet.name, rowNumber, name, reason: `Unknown place category: ${read("Category") || "(blank)"}` });
        continue;
      }
      const warnings: string[] = [];
      if (sheetName === "tours" && !read("Name of Tour")) warnings.push("Tour name missing; using provider name. Review multiple tours from this provider.");
      const interest = read("Interest"), subInterest = read("Sub-Interest", "Sub- Interest", "SubInterest");
      const description = read("Description");
      if (!interest) warnings.push("Interest missing; review before publishing.");
      if (!subInterest) warnings.push("Sub-interest missing; review before publishing.");
      if (!description) warnings.push("Description missing; review before publishing.");
      const location = read("Location", "Locations", "Location of Tour(s):") || null;
      const coordinateText = read("Coordinates");
      const [latitude, longitude] = coords(coordinateText);
      if (coordinateText && latitude === null) warnings.push("Invalid or incomplete coordinates; review manually.");
      const websiteText = readLink("Website", "Website Link", "Website/Booking Link", "Website/ Booking Link");
      const website = url(websiteText);
      if (websiteText && !website && !/^(n\/?a|no|none)$/i.test(websiteText)) warnings.push("Website is not a valid HTTP URL.");
      const imageText = readLink("Images", "Images/Videos", "Images and Videos", "Image");
      // A folder or "uploaded" note isn't an image even if it embeds a link.
      const image = /^https?:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:[?#]\S*)?$/i.test(imageText) ||
        /^www\.\S+\.(?:jpe?g|png|webp|gif)(?:[?#]\S*)?$/i.test(imageText)
        ? url(imageText) : null;
      if (imageText && !image) warnings.push("Images field contains a placeholder or non-URL; add approved image before publishing.");
      const metadata: Record<string, unknown> = {};
      // This is a deliberately explicit PUBLIC allow-list. Raw spreadsheet values
      // (including comments, staff initials and contact-person names) stay in rawColumns only.
      const publicFields: [string, string[]][] = [
        ["subtype", ["Type", "Type of Accommodation", "Type of Facility"]],
        ["openingHours", ["Opening Hours", "Operating Hours", "Opening and Closing Hours", "Opening & Closing Hours", "Start & End Time for Each Tour:"]],
        ["priceNotes", ["Entry Fee", "Cover Charge", "Price Range", "Please provide the average cost of each tour per person in TTD:"]],
        ["dressCode", ["Dress Code", "Dresscode", "Please indicate any Dress Code/Required Gear relevant to each tour:"]],
        ["accessibility", ["Accessibility Features", "Accesibilty Features", "Accessibility Rooms"]],
        ["parking", ["Parking"]],
        ["onSiteDining", ["On-Site Dining"]],
        ["datesAndTimes", ["Dates & Times"]],
      ];
      if (!standard && sheetName.startsWith("sites and attractions")) {
        const subtype = read("Category");
        if (subtype) metadata.subtype = subtype;
      }
      for (const [field, source] of publicFields) {
        const text = read(...source);
        if (text) metadata[field] = text;
      }
      const amenities = read("Amenities", ...(rowCategory === "business" ? [] : ["Special Features"]));
      if (amenities) metadata.amenities = tags(amenities);
      if (rowCategory === "business") {
        const features = read("Special Features", "Features");
        if (features) metadata.specialFeatures = tags(features);
      }
      if (sheetName === "tours" && provider) metadata.provider = provider;
      if (sheetName === "festivals") {
        const organizer = read("Organizer");
        if (organizer && organizer !== "N/A") metadata.organizer = organizer;
      }
      const booking = url(readLink("Booking Link"));
      if (booking) metadata.bookingUrl = booking;
      const menu = url(readLink("Menu (PDF/LINK)"));
      if (menu) metadata.menuUrl = menu;
      const socials: Record<string, string> = {};
      const socialNotes: Record<string, string> = {};
      for (const [key, sources] of Object.entries({
        facebook: ["Facebook Link", "Facebook"],
        instagram: ["Instagram Link", "Instagram"],
        tiktok: ["TikTok Link", "TikTok"],
        tripAdvisor: ["Trip Advisor Link"],
        youtube: ["Youtube"],
        x: ["X"],
      })) {
        const rawSocial = readLink(...sources);
        const found = url(rawSocial);
        if (found) socials[key] = found;
        else if (/^@[a-z0-9._-]+$/i.test(rawSocial)) socialNotes[key] = rawSocial;
      }
      if (indexed.includes("socialmedia")) {
        for (let c = 1; c <= columns; c++) {
          if (indexed[c - 1] !== "socialmedia") continue;
          const found = url(link(row.getCell(c)));
          if (found) {
            const hostname = new URL(found).hostname.toLowerCase();
            const platform = hostname.includes("facebook") ? "facebook" : hostname.includes("instagram") ? "instagram" : hostname.includes("tiktok") ? "tiktok" : hostname.includes("youtube") ? "youtube" : hostname === "x.com" ? "x" : null;
            if (platform) socials[platform] = found;
          } else {
            const rawSocial = value(row.getCell(c));
            if (/^@[a-z0-9._-]+$/i.test(rawSocial)) socialNotes[`column${c}`] = rawSocial;
          }
        }
      }
      if (Object.keys(socials).length) metadata.socials = socials;
      if (Object.keys(socialNotes).length) metadata.socialNotes = socialNotes;
      const emailText = read("Email", "Email Address", "Contact Email", "Contact Information", "Contact Information ", "Organizer Contact Info");
      const email = emailText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? null;
      const phoneText = read("Phone", "Phone Number", "Contact Number", "Contact Information", "Organizer Contact Info");
      const phone = phoneText.split(/\n/).map(v => v.trim()).find(v => /^(?:\+?\d[\d\s().–-]{6,}|\(?868\)?[\d\s().–-]{6,})$/.test(v)) ?? null;
      const parsed: PlaceImportRow = {
        key: identity(rowCategory, name, location), sheet: sheet.name, rowNumber,
        verified: sheetName.endsWith("verified"), warnings, rawColumns,
        data: { category: rowCategory, name, interest, subInterest, description, location, latitude, longitude,
          website, phone, email, featuredImage: image, galleryImages: [], rewardPoints: 0, metadata },
      };
      const sameName = `${rowCategory}:${norm(name)}`;
      let existing = keys.get(parsed.key);
      // Verified entries can correct addresses. Only reconcile by name if exactly
      // one same-category candidate exists; never guess between homonyms.
      const matchingNames = names.get(sameName) ?? [];
      if (existing === undefined && parsed.verified && matchingNames.length === 1) existing = matchingNames[0];
      if (existing !== undefined) {
        const old = preview.rows[existing];
        if (parsed.verified && !old.verified) {
          parsed.key = old.key;
          parsed.warnings = Array.from(new Set([...old.warnings, ...parsed.warnings]));
          if (norm(old.data.location ?? "") !== norm(location ?? "")) parsed.warnings.push("Verified location differs from original; review identity.");
          preview.rows[existing] = parsed;
          preview.skipped.push({ sheet: old.sheet, rowNumber: old.rowNumber, name: old.data.name, reason: "Superseded by verified entry." });
        } else {
          old.warnings = Array.from(new Set([...old.warnings, ...parsed.warnings, "Duplicate place entry; review source sheets."]));
          preview.skipped.push({ sheet: sheet.name, rowNumber, name, reason: "Duplicate place entry." });
        }
      } else {
        if (parsed.verified && matchingNames.length > 1) parsed.warnings.push("Multiple same-name candidates; verified identity could not be resolved automatically.");
        for (const other of preview.rows) {
          if (other.data.category !== rowCategory && norm(other.data.name) === norm(name)) {
            const warning = "Same name appears in another category; review possible cross-category duplicate.";
            if (!other.warnings.includes(warning)) other.warnings.push(warning);
            if (!parsed.warnings.includes(warning)) parsed.warnings.push(warning);
          }
        }
        keys.set(parsed.key, preview.rows.length);
        names.set(sameName, [...matchingNames, preview.rows.length]);
        preview.rows.push(parsed);
      }
      record.rows++;
    }
  }
  return preview;
}

export async function createPlaceTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Places");
  sheet.addRow(["Category", "Name", "Interest", "Sub-Interest", "Description", "Location", "Coordinates", "Website", "Phone", "Email"]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach(column => { column.width = 22; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}