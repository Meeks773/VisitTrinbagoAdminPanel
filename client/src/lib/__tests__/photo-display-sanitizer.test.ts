import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCanvasBlob, sanitizeDisplayBytes } from "../photo-display-sanitizer";
import { inspectImage, validateImageBytes, sha256 } from "../../../../server/photo-import/image-validation";

const ascii = (s: string) => Buffer.from(s, "ascii");
const segment = (marker: number, data: Buffer) => {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
};
const entropy = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
const frame = segment(0xc0, Buffer.from([8, 0, 20, 0, 30, 1, 1, 0x11, 0]));
const scan = segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
const jpeg = (before: Buffer[] = [], after: Buffer[] = []) =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), ...before, frame, scan, entropy, ...after, Buffer.from([0xff, 0xd9])]);
function webp(chunks: Array<[string, Buffer]>) {
  const body = Buffer.concat(chunks.map(([name, payload]) => {
    const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload, ...(payload.length & 1 ? [Buffer.alloc(1)] : [])]);
  }));
  const header = Buffer.alloc(12); header.write("RIFF"); header.writeUInt32LE(body.length + 4, 4); header.write("WEBP", 8);
  return Buffer.concat([header, body]);
}
function webpParts(flags: number): Array<[string, Buffer]> {
  const extended = Buffer.alloc(10); extended[0] = flags; extended.writeUIntLE(29, 4, 3); extended.writeUIntLE(19, 7, 3);
  const pixels = Buffer.alloc(10); pixels.set([0x9d, 0x01, 0x2a], 3); pixels.writeUInt16LE(30, 6); pixels.writeUInt16LE(20, 8);
  return [["VP8X", extended], ["ALPH", Buffer.from([0, 1, 2])], ["VP8 ", pixels]];
}
const validate = (bytes: Uint8Array) => validateImageBytes(Buffer.from(bytes), {
  maxBytes: 20 * 1024 * 1024, allowedFormats: ["jpeg", "webp"], requireMetadataFree: true,
});

test("JPEG sanitizer removes every APPn/COM including metadata after a scan without changing entropy", () => {
  const privateHeaders = Array.from({ length: 16 }, (_, i) => segment(0xe0 + i, ascii(`private-${i}`)));
  const input = jpeg(privateHeaders, [segment(0xfe, ascii("GPS/comment")), segment(0xe1, ascii("Exif"))]);
  const snapshot = Buffer.from(input);
  assert.throws(() => validate(input), /metadata/);
  const output = sanitizeDisplayBytes(input, "jpeg");
  assert.deepEqual(Buffer.from(output), jpeg());
  assert.deepEqual(input, snapshot);
  assert.equal(validate(output).metadataFree, true);
});
test("WebP removes ICC/EXIF/XMP and matching flags, retaining alpha, dimensions and image bytes", () => {
  const input = webp([...webpParts(0x3c), ["ICCP", ascii("profile")], ["EXIF", ascii("GPS")], ["XMP ", ascii("private")]]);
  const snapshot = Buffer.from(input);
  assert.throws(() => validate(input), /metadata/);
  const output = sanitizeDisplayBytes(input, "webp");
  assert.deepEqual(Buffer.from(output), webp(webpParts(0x10)));
  assert.deepEqual(input, snapshot);
  assert.deepEqual(validate(output), { format: "webp", width: 30, height: 20, metadataFree: true, animated: false });
});
test("metadata-free display images remain byte-identical and repeated sanitization is stable", () => {
  for (const [format, input] of [["jpeg", jpeg()], ["webp", webp(webpParts(0x10))]] as const) {
    const clean = sanitizeDisplayBytes(input, format);
    assert.deepEqual(Buffer.from(clean), input);
    assert.deepEqual(sanitizeDisplayBytes(clean, format), clean);
  }
});
test("invalid/truncated containers, unknown WebP chunks, animation and oversize fail closed", () => {
  for (const input of [jpeg().subarray(0, -1), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.alloc(20 * 1024 * 1024 + 1)]) {
    assert.throws(() => sanitizeDisplayBytes(input, "jpeg"), /invalid display/);
  }
  const badLength = webp(webpParts(0x10)); badLength.writeUInt32LE(0xffffffff, 16);
  for (const input of [badLength, webp(webpParts(0x12)), webp([...webpParts(0x10), ["ANIM", Buffer.alloc(6)]]), webp([...webpParts(0x10), ["text", ascii("private")]])]) {
    assert.throws(() => sanitizeDisplayBytes(input, "webp"), /invalid display/);
  }
});
test("server rejects metadata-bearing APP0/JFXX and thumbnails but accepts minimal JFIF", () => {
  const jfif = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  assert.equal(validate(jpeg([segment(0xe0, jfif)])).metadataFree, true);
  const thumbnail = Buffer.from(jfif); thumbnail[12] = 1; thumbnail[13] = 1;
  for (const payload of [ascii("JFXX\0private"), ascii("unknown"), Buffer.concat([thumbnail, Buffer.from([1, 2, 3])])]) {
    assert.equal(inspectImage(jpeg([segment(0xe0, payload)])).metadataFree, false);
    assert.throws(() => validate(jpeg([segment(0xe0, payload)])), /metadata/);
  }
});
test("sanitized blob size and hash describe uploaded bytes, with explicit format and unchanged source", async () => {
  const original = jpeg([segment(0xe1, ascii("Exif GPS"))]);
  const blob = new Blob([original], { type: "image/jpeg" });
  const clean = await sanitizeCanvasBlob(blob, "jpeg");
  assert.equal(clean.type, "image/jpeg");
  assert.equal(clean.size, jpeg().length);
  assert.equal(sha256(new Uint8Array(await clean.arrayBuffer())), sha256(jpeg()));
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), original);
  await assert.rejects(sanitizeCanvasBlob(blob, "webp"), /invalid display/);
});