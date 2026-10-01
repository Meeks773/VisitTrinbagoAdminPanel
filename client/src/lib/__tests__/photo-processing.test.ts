import test from "node:test";
import assert from "node:assert/strict";
import { issueCode, mergeIssues, parseDimensions, fitInside, naturalCompare, sniffImage, preflight, withRetry, orderFileIds, sha256Hex } from "../photo-processing";

function bigPng(animated: boolean) {
  const out = new Uint8Array(300 * 1024); out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const put = (i: number, len: number, t: string) => { out[i + 3] = len; out.set([...t].map((c) => c.charCodeAt(0)), i + 4); return i + 12 + len; };
  let i = put(8, 13, "IHDR");
  if (animated) i = put(i, 8, "acTL");
  put(i, 100000, "IDAT");
  return out;
}
function bigWebp(animated: boolean) {
  const out = new Uint8Array(300 * 1024); out.set([..."RIFF"].map((c) => c.charCodeAt(0))); out.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  out.set([..."VP8X"].map((c) => c.charCodeAt(0)), 12); out[16] = 10; out[20] = animated ? 0x02 : 0;
  out.set([..."VP8 "].map((c) => c.charCodeAt(0)), 30); out[34] = 0xff; out[35] = 0xff;
  return out;
}
test("large PNG/WebP buffers do not throw and detect animation", () => {
  assert.deepEqual(sniffImage(bigPng(false)), { type: "image/png" });
  assert.ok("error" in sniffImage(bigPng(true)));
  assert.deepEqual(sniffImage(bigWebp(false)), { type: "image/webp" });
  assert.ok("error" in sniffImage(bigWebp(true)));
  const big = new Uint8Array(1024 * 1024); big.set([0x89, 0x50, 0x4e, 0x47]);
  assert.doesNotThrow(() => sniffImage(big));
});
const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

test("fitInside never upscales", () => {
  assert.deepEqual(fitInside(400, 300, 640), { width: 400, height: 300 });
  assert.deepEqual(fitInside(4000, 2000, 1600), { width: 1600, height: 800 });
});
test("natural ordering", () => {
  assert.deepEqual(["a10.jpg", "a2.jpg", "a1.jpg"].sort(naturalCompare), ["a1.jpg", "a2.jpg", "a10.jpg"]);
});
test("sniff detects types and animation", () => {
  assert.deepEqual(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), { type: "image/jpeg" });
  assert.ok("error" in sniffImage(bytes("GIF89a......")));
  assert.deepEqual(sniffImage(bytes("RIFF....WEBPVP8 ")), { type: "image/webp" });
});
test("preflight limits", () => {
  assert.ok(preflight("a.jpg", 51 * 1024 * 1024));
  assert.ok(preflight("a.gif", 10));
  assert.equal(preflight("a.jpg", 10), null);
});
test("retry is bounded at 3", async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new Error("x"); }, 3, () => true));
  assert.equal(n, 3);
});
test("cover first then sequence", () => {
  assert.deepEqual(orderFileIds(["a", "b", "c"], { a: "1.jpg", b: "2.jpg", c: "3.jpg" }, "c"), ["c", "a", "b"]);
});
test("sha256", async () => {
  assert.equal(await sha256Hex(new ArrayBuffer(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("parseDimensions reads PNG, JPEG, WebP headers", () => {
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x1f, 0x40, 0, 0, 0x0f, 0xa0]);
  assert.deepEqual(parseDimensions(png), { width: 8000, height: 4000 });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x0f, 0xa0, 0x1f, 0x40, 3, 0, 0, 0, 0]);
  assert.deepEqual(parseDimensions(jpg), { width: 8000, height: 4000 });
  const webp = new Uint8Array(32); webp.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0); webp.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
  webp.set([99, 0, 0, 49, 0, 0], 24);
  assert.deepEqual(parseDimensions(webp), { width: 100, height: 50 });
  assert.equal(parseDimensions(new Uint8Array(40)), null);
});

test("issue codes and dedupe", () => {
  assert.equal(issueCode("Image exceeds 40 megapixels"), "too_large");
  assert.equal(issueCode("Animated WebP is not supported"), "animated");
  const m = mergeIssues([{ filename: "a", code: "x" }], [{ filename: "a", code: "x" }, { filename: "a", code: "y" }]);
  assert.equal(m.length, 2);
});
