import { createHash } from "node:crypto";

export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_VARIANT_BYTES = 20 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 40_000_000;

export type ImageFormat = "jpeg" | "png" | "webp";
export interface ImageInspection {
  format: ImageFormat;
  width: number;
  height: number;
  metadataFree: boolean;
  animated: boolean;
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message: string): never {
  throw new ImageValidationError(message);
}

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail("Image has invalid dimensions");
  }
  if (width * height > MAX_SOURCE_PIXELS) fail("Image exceeds the 40-megapixel limit");
}

function inspectJpeg(bytes: Buffer): ImageInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("Corrupt JPEG signature");
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let metadataFree = true;
  let ended = false;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail("Corrupt JPEG marker stream");
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) fail("Truncated JPEG marker");
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      ended = true;
      break;
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      fail("Unexpected standalone JPEG marker");
    }
    if (offset + 2 > bytes.length) fail("Truncated JPEG segment");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail("Invalid JPEG segment length");
    const payloadStart = offset + 2;
    const payloadLength = length - 2;

    if (marker >= 0xe0 && marker <= 0xef || marker === 0xfe) {
      // Only a minimal JFIF header is structural. APP0 can also carry
      // JFXX/arbitrary data or embedded thumbnails, so it is not a blanket exception.
      if (marker !== 0xe0 || payloadLength !== 14 || bytes.toString("ascii", payloadStart, payloadStart + 5) !== "JFIF\0"
        || bytes[payloadStart + 12] !== 0 || bytes[payloadStart + 13] !== 0) {
        metadataFree = false;
      }
    }
    if (sof.has(marker)) {
      if (payloadLength < 6) fail("Truncated JPEG frame header");
      height = bytes.readUInt16BE(payloadStart + 1);
      width = bytes.readUInt16BE(payloadStart + 3);
      dimensions(width, height);
    }
    offset += length;
    if (marker === 0xda) {
      sawScan = true;
      // Entropy-coded data may contain stuffed FF bytes and restart markers.
      // Continue at the next real marker; the following outer iteration
      // validates all remaining segment boundaries without decoding pixels.
      while (offset < bytes.length) {
        const markerStart = offset;
        if (bytes[offset++] !== 0xff) continue;
        while (offset < bytes.length && bytes[offset] === 0xff) offset++;
        if (offset >= bytes.length) fail("Truncated JPEG scan");
        const scanMarker = bytes[offset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset++;
          continue;
        }
        offset = markerStart;
        break;
      }
    }
  }
  if (!ended || !sawScan || offset !== bytes.length) {
    fail("Corrupt or truncated JPEG image");
  }
  if (!width || !height) fail("JPEG is missing its frame dimensions");
  dimensions(width, height);
  return { format: "jpeg", width, height, metadataFree, animated: false };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function inspectPng(bytes: Buffer): ImageInspection {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail("Corrupt PNG signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  let sawEnd = false;
  let metadataFree = true;
  let chunkCount = 0;
  while (offset + 12 <= bytes.length && !sawEnd) {
    if (++chunkCount > 4096) fail("PNG contains too many chunks");
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const type = bytes.toString("ascii", typeStart, typeStart + 4);
    const end = offset + 12 + length;
    if (length > bytes.length || end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) fail("Invalid PNG chunk");
    if (offset === 8 && (type !== "IHDR" || length !== 13)) fail("PNG must begin with a valid IHDR chunk");
    if (type === "IHDR") {
      if (offset !== 8 || width !== 0) fail("Invalid PNG header order");
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      dimensions(width, height);
    } else if (type === "IDAT") {
      if (!width) fail("PNG image data precedes its header");
      sawData = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawData) fail("Invalid PNG end chunk");
      sawEnd = true;
    } else if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      fail("Animated PNG is not supported");
    } else if (type !== "PLTE") {
      // Ancillary chunks carry metadata or unsupported extensions. Refuse
      // them in display copies rather than accidentally preserving metadata.
      if ((type.charCodeAt(0) & 0x20) !== 0) metadataFree = false;
      else fail(`Unsupported PNG chunk ${type}`);
    }
    offset = end;
  }
  if (!sawEnd || offset !== bytes.length || !width || !height) fail("Corrupt or truncated PNG image");
  dimensions(width, height);
  return { format: "png", width, height, metadataFree, animated: false };
}

function read24le(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function inspectWebp(bytes: Buffer): ImageInspection {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    fail("Corrupt WebP signature");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) fail("Invalid WebP container length");
  let offset = 12;
  let width = 0;
  let height = 0;
  let metadataFree = true;
  let animated = false;
  let frameCount = 0;
  let frameWidth = 0;
  let frameHeight = 0;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const paddedLength = length + (length & 1);
    if (length > bytes.length || data + paddedLength > bytes.length) fail("Invalid WebP chunk length");
    if (type === "VP8X") {
      if (length < 10) fail("Truncated WebP extended header");
      const flags = bytes[data];
      if (flags & 0x02) animated = true;
      if (flags & (0x20 | 0x08 | 0x04)) metadataFree = false;
      width = read24le(bytes, data + 4) + 1;
      height = read24le(bytes, data + 7) + 1;
    } else if (type === "VP8 ") {
      if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        fail("Corrupt lossy WebP frame");
      }
      frameCount++;
      frameWidth = bytes.readUInt16LE(data + 6) & 0x3fff;
      frameHeight = bytes.readUInt16LE(data + 8) & 0x3fff;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[data] !== 0x2f) fail("Corrupt lossless WebP frame");
      frameCount++;
      frameWidth = 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8);
      frameHeight = 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10);
    } else if (type === "ANIM" || type === "ANMF") {
      animated = true;
    } else if (type === "EXIF" || type === "XMP " || type === "ICCP") {
      metadataFree = false;
    } else if (type !== "ALPH") {
      fail("Unsupported WebP chunk");
    }
    offset = data + paddedLength;
  }
  if (offset !== bytes.length || frameCount !== 1 || !frameWidth || !frameHeight) fail("Corrupt or incomplete WebP image");
  if (animated) fail("Animated WebP is not supported");
  if ((width && width !== frameWidth) || (height && height !== frameHeight)) {
    fail("WebP extended dimensions do not match the coded image frame");
  }
  width = frameWidth;
  height = frameHeight;
  dimensions(width, height);
  return { format: "webp", width, height, metadataFree, animated };
}

export function inspectImage(bytes: Buffer): ImageInspection {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail("Image is empty");
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return inspectPng(bytes);
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return inspectWebp(bytes);
  }
  fail("Unsupported image format; only JPEG, PNG and static WebP are accepted");
}

export function validateImageBytes(
  bytes: Buffer,
  options: { maxBytes: number; allowedFormats: readonly ImageFormat[]; requireMetadataFree?: boolean },
): ImageInspection {
  if (bytes.length < 1 || bytes.length > options.maxBytes) fail("Image byte size is outside the supported limit");
  const inspection = inspectImage(bytes);
  if (!options.allowedFormats.includes(inspection.format)) fail("Image format does not match the allowed format");
  if (options.requireMetadataFree && !inspection.metadataFree) fail("Display image contains metadata");
  return inspection;
}

export function dimensionsDoNotUpscale(
  source: Pick<ImageInspection, "width" | "height">,
  variant: Pick<ImageInspection, "width" | "height">,
): boolean {
  const direct = variant.width <= source.width && variant.height <= source.height;
  const orientationSwapped = variant.width <= source.height && variant.height <= source.width;
  return direct || orientationSwapped;
}