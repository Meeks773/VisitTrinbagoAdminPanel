/** Strip metadata from browser-encoded display copies, never from originals. */
const MAX_DISPLAY_BYTES = 20 * 1024 * 1024;
const MAX_CHUNKS = 4096;

function invalid(): never { throw new Error("Browser produced an invalid display image"); }
function tag(bytes: Uint8Array, offset: number, value: string): boolean {
  return offset >= 0 && offset + value.length <= bytes.length
    && Array.from(value).every((c, i) => bytes[offset + i] === c.charCodeAt(0));
}
function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function cleanJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  const parts = [bytes.subarray(0, 2)];
  let offset = 2, segments = 0, ended = false;
  while (offset < bytes.length) {
    if (++segments > MAX_CHUNKS) invalid();
    const start = offset;
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      parts.push(bytes.subarray(start, offset)); ended = true; break;
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (offset + 2 > bytes.length) invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) invalid();
    const end = offset + length;
    // Canvas pixels are already sRGB and orientation-correct. APPn/COM are
    // unnecessary here and may contain ICC, EXIF/GPS, XMP or thumbnails.
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) {
      parts.push(bytes.subarray(start, end));
    }
    offset = end;
    if (marker === 0xda) {
      const scanStart = offset;
      while (offset < bytes.length) {
        const markerStart = offset;
        if (bytes[offset++] !== 0xff) continue;
        while (offset < bytes.length && bytes[offset] === 0xff) offset++;
        if (offset >= bytes.length) invalid();
        const scanMarker = bytes[offset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) { offset++; continue; }
        offset = markerStart; break;
      }
      // Preserve entropy bytes verbatim, including stuffing/restart markers.
      parts.push(bytes.subarray(scanStart, offset));
    }
  }
  if (!ended || offset !== bytes.length) invalid();
  return join(parts);
}

function cleanWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 20 || !tag(bytes, 0, "RIFF") || !tag(bytes, 8, "WEBP")) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) invalid();
  const parts: Uint8Array[] = [];
  let offset = 12, chunks = 0;
  while (offset + 8 <= bytes.length) {
    if (++chunks > MAX_CHUNKS) invalid();
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8, end = data + length + (length & 1);
    if (end > bytes.length) invalid();
    if (tag(bytes, offset, "ICCP") || tag(bytes, offset, "EXIF") || tag(bytes, offset, "XMP ")) {
      // Remove the entire chunk, including its padding.
    } else if (tag(bytes, offset, "VP8X")) {
      if (length !== 10 || (bytes[data] & 0xc3) || bytes[data + 1] || bytes[data + 2] || bytes[data + 3]) invalid();
      const chunk = Uint8Array.from(bytes.subarray(offset, end));
      chunk[8] &= ~0x2c; // Clear ICC/EXIF/XMP flags, preserve alpha.
      parts.push(chunk);
    } else if (tag(bytes, offset, "VP8 ") || tag(bytes, offset, "VP8L") || tag(bytes, offset, "ALPH")) {
      parts.push(bytes.subarray(offset, end));
    } else {
      // No unknown/animated chunks can hide data in public copies.
      invalid();
    }
    offset = end;
  }
  if (offset !== bytes.length) invalid();
  const header = Uint8Array.from(bytes.subarray(0, 12));
  new DataView(header.buffer, header.byteOffset, header.byteLength)
    .setUint32(4, 4 + parts.reduce((n, part) => n + part.length, 0), true);
  return join([header, ...parts]);
}

export function sanitizeDisplayBytes(bytes: Uint8Array, format: "jpeg" | "webp"): Uint8Array {
  if (bytes.length < 1 || bytes.length > MAX_DISPLAY_BYTES) invalid();
  return format === "jpeg" ? cleanJpeg(bytes) : cleanWebp(bytes);
}

export async function sanitizeCanvasBlob(blob: Blob, format: "jpeg" | "webp"): Promise<Blob> {
  const type = format === "jpeg" ? "image/jpeg" : "image/webp";
  if (blob.type !== type || blob.size > MAX_DISPLAY_BYTES) invalid();
  return new Blob([sanitizeDisplayBytes(new Uint8Array(await blob.arrayBuffer()), format)], { type });
}