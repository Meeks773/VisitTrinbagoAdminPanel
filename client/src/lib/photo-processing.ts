import type { PhotoImportFileInput, VariantDeclaration } from "@shared/photo-import-types";

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const CARD_EDGE = 640;
export const DETAIL_EDGE = 1600;
export const MAX_ATTEMPTS = 3;

export type ContentType = PhotoImportFileInput["contentType"];

export function fitInside(w: number, h: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(w, h)); // never upscale
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export async function sha256Hex(data: ArrayBuffer | Blob): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function tagAt(h: Uint8Array, i: number, t: string): boolean {
  if (i < 0 || i + t.length > h.length) return false;
  for (let k = 0; k < t.length; k++) if (h[i + k] !== t.charCodeAt(k)) return false;
  return true;
}

/** Sniff actual type from signature bytes and detect animation by walking chunks (no string building, no argument spreading). */
export function sniffImage(head: Uint8Array): { type: ContentType } | { error: string } {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { type: "image/jpeg" };
  if (head.length >= 8 && head[0] === 0x89 && tagAt(head, 1, "PNG")) {
    let i = 8;
    while (i + 8 <= head.length) {
      const len = ((head[i] << 24) | (head[i + 1] << 16) | (head[i + 2] << 8) | head[i + 3]) >>> 0;
      if (tagAt(head, i + 4, "acTL")) return { error: "Animated PNG is not supported" };
      if (tagAt(head, i + 4, "IDAT") || tagAt(head, i + 4, "IEND")) break;
      i += 12 + len;
    }
    return { type: "image/png" };
  }
  if (head.length >= 12 && tagAt(head, 0, "RIFF") && tagAt(head, 8, "WEBP")) {
    let i = 12;
    while (i + 8 <= head.length) {
      const len = (head[i + 4] | (head[i + 5] << 8) | (head[i + 6] << 16) | (head[i + 7] << 24)) >>> 0;
      if (tagAt(head, i, "ANIM") || tagAt(head, i, "ANMF")) return { error: "Animated WebP is not supported" };
      if (tagAt(head, i, "VP8X") && i + 8 < head.length && (head[i + 8] & 0x02)) return { error: "Animated WebP is not supported" };
      i += 8 + len + (len & 1);
    }
    return { type: "image/webp" };
  }
  return { error: "Unsupported or corrupt file (only JPEG, PNG and static WebP are accepted)" };
}

export const HEADER_BYTES = 1024 * 1024;

/** Parse pixel dimensions from bounded header bytes (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X). */
export function parseDimensions(h: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (h[i] << 8) | h[i + 1];
  const u32 = (i: number) => ((h[i] << 24) | (h[i + 1] << 16) | (h[i + 2] << 8) | h[i + 3]) >>> 0;
  const le24 = (i: number) => h[i] | (h[i + 1] << 8) | (h[i + 2] << 16);
  const tag = (i: number) => String.fromCharCode(h[i], h[i + 1], h[i + 2], h[i + 3]); // exactly 4 bytes
  if (h.length > 3 && h[0] === 0xff && h[1] === 0xd8) {
    let i = 2;
    while (i + 9 < h.length) {
      if (h[i] !== 0xff) { i++; continue; }
      const m = h[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: u16(i + 5), width: u16(i + 7) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (h.length >= 24 && h[0] === 0x89 && tag(12) === "IHDR") return { width: u32(16), height: u32(20) };
  if (h.length >= 30 && tag(0) === "RIFF" && tag(8) === "WEBP") {
    const t = tag(12);
    if (t === "VP8X") return { width: le24(24) + 1, height: le24(27) + 1 };
    if (t === "VP8L" && h[20] === 0x2f) { const b = h[21] | (h[22] << 8) | (h[23] << 16) | (h[24] << 24); return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 }; }
    if (t === "VP8 ") return { width: (h[26] | (h[27] << 8)) & 0x3fff, height: (h[28] | (h[29] << 8)) & 0x3fff };
  }
  return null;
}

export function preflight(name: string, size: number): string | null {
  if (size <= 0) return "File is empty";
  if (size > MAX_BYTES) return "File is larger than 50 MiB";
  if (/\.(gif|heic|heif|avif|tiff?|bmp|svg)$/i.test(name)) return "Unsupported format";
  return null;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = MAX_ATTEMPTS, shouldRetry: (e: unknown) => boolean = () => true): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!shouldRetry(e) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

export interface Variant { blob: Blob; decl: VariantDeclaration; contentType: string }
export interface ProcessedPhoto {
  filename: string; contentType: ContentType; sha256: string; bytes: number;
  card: Variant; detail: Variant;
}

async function render(bitmap: ImageBitmap, edge: number, quality: number): Promise<Variant> {
  const { width, height } = fitInside(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    let format: "webp" | "jpeg" = "webp";
    if (!blob || blob.type !== "image/webp") {
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      format = "jpeg";
    }
    if (!blob) throw new Error("Could not encode image");
    const sha256 = await sha256Hex(blob);
    return { blob, contentType: blob.type, decl: { sha256, bytes: blob.size, width, height, format } };
  } finally {
    canvas.width = 0; canvas.height = 0; // release backing buffer
  }
}

/** Hash + validate original only (cheap pass used to skip ready files). */
export async function inspectOriginal(file: File): Promise<{ contentType: ContentType; sha256: string } | { error: string }> {
  const pre = preflight(file.name, file.size);
  if (pre) return { error: pre };
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const sniff = sniffImage(head);
  if ("error" in sniff) return sniff;
  const dims = parseDimensions(head);
  if (!dims || dims.width < 1 || dims.height < 1) return { error: "Image dimensions could not be read (corrupt file)" };
  if (dims.width * dims.height > MAX_PIXELS) return { error: "Image exceeds 40 megapixels" };
  return { contentType: sniff.type, sha256: await sha256Hex(await file.arrayBuffer()) };
}

export async function processPhoto(file: File, contentType: ContentType, sha256: string): Promise<ProcessedPhoto | { error: string }> {
  let bitmap: ImageBitmap | null = null;
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return { error: "Image is corrupt or cannot be decoded" };
    }
    if (bitmap.width * bitmap.height > MAX_PIXELS) return { error: "Image exceeds 40 megapixels" };
    const card = await render(bitmap, CARD_EDGE, 0.8);
    const detail = await render(bitmap, DETAIL_EDGE, 0.82);
    return { filename: file.name, contentType, sha256, bytes: file.size, card, detail };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Processing failed" };
  } finally {
    bitmap?.close();
  }
}

/** Direct signed PUT. Never logs or persists the URL. */
export async function putObject(url: string, body: Blob, contentType: string): Promise<void> {
  await withRetry(async () => {
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  });
}

/** Assign sensible default order: filename sequence, cover first. */
export function orderFileIds(ids: string[], names: Record<string, string>, coverId: string | null): string[] {
  const sorted = [...ids].sort((a, b) => naturalCompare(names[a] ?? "", names[b] ?? ""));
  return coverId && sorted.includes(coverId) ? [coverId, ...sorted.filter((i) => i !== coverId)] : sorted;
}

export function issueCode(message: string): string {
  if (/50 MiB|40 megapixels/.test(message)) return "too_large";
  if (/Animated/.test(message)) return "animated";
  if (/Unsupported/.test(message)) return "unsupported";
  if (/corrupt|decoded|dimensions/i.test(message)) return "corrupt";
  if (/different content/.test(message)) return "changed";
  return "failed";
}

export interface IssueLike { filename: string; code: string }
export function mergeIssues<T extends IssueLike>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((i) => { const k = `${i.filename}\u0000${i.code}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
