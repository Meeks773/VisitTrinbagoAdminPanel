export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// XLSX is a ZIP archive. Bound its declared expanded size before ExcelJS loads it.
export function validateWorkbookArchive(buffer: Buffer) {
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("Workbook exceeds the 5 MB upload limit.");
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Upload an .xlsx workbook, not a renamed CSV or another file type.");
  }
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("The workbook archive is incomplete.");
  const entries = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) ||
      entries > 5000 || offset + directorySize > end) {
    throw new Error("This workbook archive is too complex or unsupported.");
  }
  let expandedSize = 0;
  let hasWorkbook = false;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid workbook archive directory.");
    }
    if (buffer.readUInt16LE(offset + 8) & 1) throw new Error("Password-protected workbooks are not supported.");
    expandedSize += buffer.readUInt32LE(offset + 24);
    if (expandedSize > 40 * 1024 * 1024) throw new Error("Workbook expands beyond the 40 MB safety limit.");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (next > end) throw new Error("Invalid workbook archive entry.");
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === "xl/workbook.xml") hasWorkbook = true;
    if (name.toLowerCase().endsWith("vbaproject.bin")) throw new Error("Macro-enabled files are not supported.");
    offset = next;
  }
  if (!hasWorkbook) throw new Error("The file does not contain an Excel workbook.");
}