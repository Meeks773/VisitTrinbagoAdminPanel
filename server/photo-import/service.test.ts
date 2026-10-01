import test from "node:test";
import assert from "node:assert/strict";
import type { MediaSnapshot, PhotoImportBatch, PhotoImportCatalogItem, PhotoImportFileInput } from "../../shared/photo-import-types";
import type { Listing } from "../../shared/schema";
import { photoMediaSchema, safePhotoMedia } from "../../shared/photo-media";
import { publicListing } from "../publication";
import { listingPhotoWriteError, reconcileListingPhotoPatch } from "./listing-write-validation";
import { prepareGuardedListingPatch } from "./listing-update";
import { reconcilePhotoMedia } from "./media-reconciliation";
import {
  dimensionsDoNotUpscale,
  ImageValidationError,
  inspectImage,
  sha256,
  validateImageBytes,
} from "./image-validation";
import { PhotoImportError } from "./repository";
import type {
  PhotoImportListing,
  PhotoImportRepository,
  PhotoImportTransaction,
} from "./repository";
import { PhotoImportService, type PhotoImportObjectStorage, type PhotoUploadKind } from "./service";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function png(width: number, height: number, chunks: Array<[string, Buffer]> = []): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", Buffer.from([1, 2, 3])),
    ...chunks.map(([type, data]) => chunk(type, data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function webp(width: number, height: number, options: { flags?: number; exif?: boolean } = {}): Buffer {
  const chunks: Buffer[] = [];
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32LE(data.length, 4);
    chunks.push(header, data);
    if (data.length % 2) chunks.push(Buffer.alloc(1));
  };
  const extended = Buffer.alloc(10);
  extended[0] = options.flags ?? 0;
  extended.writeUIntLE(width - 1, 4, 3);
  extended.writeUIntLE(height - 1, 7, 3);
  chunk("VP8X", extended);
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  chunk("VP8 ", frame);
  if (options.exif) chunk("EXIF", Buffer.from("synthetic-metadata"));
  const body = Buffer.concat(chunks);
  const prefix = Buffer.alloc(12);
  prefix.write("RIFF", 0, 4, "ascii");
  prefix.writeUInt32LE(body.length + 4, 4);
  prefix.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([prefix, body]);
}

class MemoryRepository implements PhotoImportRepository {
  readonly batches = new Map<string, PhotoImportBatch>();
  readonly listings = new Map<number, PhotoImportListing>();
  private tail: Promise<void> = Promise.resolve();

  async createBatch(batch: PhotoImportBatch) {
    this.batches.set(batch.id, structuredClone(batch));
  }

  async listBatches() {
    return [...this.batches.values()].map((batch) => ({
      id: batch.id,
      name: batch.name,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      fileCount: batch.files.length,
    }));
  }

  async getBatch(id: string) {
    return structuredClone(this.batches.get(id) ?? null);
  }

  async getCatalog(): Promise<PhotoImportCatalogItem[]> {
    return [...this.listings.values()].map(({ id, name, category, location, status }) => ({ id, name, category, location, status }));
  }

  async withBatch<T>(id: string, action: (transaction: PhotoImportTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const stored = this.batches.get(id);
      if (!stored) throw new PhotoImportError("Photo import batch not found", 404);
      const batch = structuredClone(stored);
      const workingListings = new Map([...this.listings].map(([key, value]) => [key, structuredClone(value)]));
      let dirty = false;
      const tx: PhotoImportTransaction = {
        batch,
        async lockListings(ids) {
          return ids.map((listingId) => workingListings.get(listingId)).filter((row): row is PhotoImportListing => !!row);
        },
        async updateListingMedia(listingId, media: MediaSnapshot) {
          const listing = workingListings.get(listingId);
          if (!listing) throw new PhotoImportError("Listing no longer exists", 409);
          Object.assign(listing, structuredClone(media));
        },
        async save() {
          dirty = true;
        },
      };
      const result = await action(tx);
      if (dirty) {
        batch.updatedAt = new Date().toISOString();
        this.batches.set(id, structuredClone(batch));
        for (const [key, value] of workingListings) this.listings.set(key, value);
      }
      return result;
    } finally {
      release();
    }
  }

  updateListing(id: number, patch: Partial<PhotoImportListing>) {
    Object.assign(this.listings.get(id)!, structuredClone(patch));
  }
}

class MemoryObjects implements PhotoImportObjectStorage {
  readonly bytes = new Map<string, Buffer>();
  readonly finalWrites: { path: string; contentType: string }[] = [];
  private slot = 0;

  async createStagingUpload(batchId: string, fileId: string, kind: PhotoUploadKind) {
    const objectPath = `/objects/originals/photo-import-staging/${batchId}/${fileId}/${kind}-${++this.slot}`;
    return { uploadURL: `https://upload.invalid/synthetic-slot-${this.slot}`, objectPath };
  }

  async readPrivateObject(path: string, maxBytes: number) {
    const bytes = this.bytes.get(path);
    if (!bytes) throw new Error("synthetic missing staged object");
    if (bytes.length > maxBytes) throw new Error("synthetic staged object too large");
    return Buffer.from(bytes);
  }

  async putImmutablePrivateObject(path: string, bytes: Buffer, contentType: string) {
    assert.match(path, /^\/objects\/(?:display|originals)\/photo-imports\//);
    if (this.bytes.has(path)) {
      assert.deepEqual(this.bytes.get(path), bytes, "immutable destination cannot be overwritten");
      return;
    }
    this.bytes.set(path, Buffer.from(bytes));
    this.finalWrites.push({ path, contentType });
  }
}

function fixture() {
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  let id = 100;
  const service = new PhotoImportService({
    repository,
    objects,
    newId: () => UUID(id++),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  repository.listings.set(1, {
    id: 1,
    name: "Maracas Bay",
    category: "beaches",
    location: "Trinidad",
    status: "draft",
    featuredImage: "/objects/uploads/prior-cover",
    galleryImages: ["/objects/uploads/gallery", "/objects/uploads/prior-cover"],
    photoMedia: null,
  });
  return { repository, objects, service };
}

const sourcePng = png(800, 600);
const cardWebp = webp(640, 480);
const detailWebp = webp(800, 600);
const declaration = (bytes: Buffer, width: number, height: number) => ({
  sha256: sha256(bytes),
  bytes: bytes.length,
  width,
  height,
  format: "webp" as const,
});

async function addReadyFile(
  service: PhotoImportService,
  objects: MemoryObjects,
  batchId: string,
  options: { filename?: string; source?: Buffer; card?: Buffer; detail?: Buffer; sourceType?: PhotoImportFileInput["contentType"] } = {},
) {
  const source = options.source ?? sourcePng;
  const card = options.card ?? cardWebp;
  const detail = options.detail ?? detailWebp;
  const filename = options.filename ?? "Maracas Bay.png";
  const sourceType = options.sourceType ?? "image/png";
  const [registered] = (await service.registerFiles(batchId, [{
    filename,
    sha256: sha256(source),
    bytes: source.length,
    contentType: sourceType,
  }])).files.slice(-1);
  const cardInspection = inspectImage(card);
  const detailInspection = inspectImage(detail);
  const slots = await service.requestUploadUrls(
    batchId,
    registered.id,
    declaration(card, cardInspection.width, cardInspection.height),
    declaration(detail, detailInspection.width, detailInspection.height),
  );
  assert.equal(slots.ready, false);
  if (slots.ready) throw new Error("Expected newly reserved staging slots");
  assert.ok(slots.original.objectPath.startsWith("/objects/originals/photo-import-staging/"));
  assert.ok(slots.card.objectPath.startsWith("/objects/originals/photo-import-staging/"));
  assert.ok(slots.detail.objectPath.startsWith("/objects/originals/photo-import-staging/"));
  objects.bytes.set(slots.original.objectPath, source);
  objects.bytes.set(slots.card.objectPath, card);
  objects.bytes.set(slots.detail.objectPath, detail);
  const finalized = await service.finalize(batchId, registered.id);
  return finalized.files.find((file) => file.id === registered.id)!;
}

test("bounded image inspection recognizes formats, rejects corruption/animation/metadata and detects upscale", () => {
  assert.deepEqual(inspectImage(sourcePng), {
    format: "png", width: 800, height: 600, metadataFree: true, animated: false,
  });
  assert.equal(inspectImage(cardWebp).format, "webp");
  assert.throws(() => inspectImage(Buffer.from("GIF89a")), ImageValidationError);
  assert.throws(() => inspectImage(png(10, 10, [["acTL", Buffer.alloc(8)]])), /Animated PNG/);
  assert.throws(() => inspectImage(webp(10, 10, { flags: 2 })), /Animated WebP/);
  const badExtendedDimensions = Buffer.from(webp(10, 10));
  badExtendedDimensions.writeUIntLE(8, 24, 3);
  assert.throws(() => inspectImage(badExtendedDimensions), /dimensions do not match/);
  assert.throws(() => validateImageBytes(webp(10, 10, { exif: true }), {
    maxBytes: 1024, allowedFormats: ["webp"], requireMetadataFree: true,
  }), /metadata/);
  assert.equal(dimensionsDoNotUpscale({ width: 800, height: 600 }, { width: 600, height: 800 }), true);
  assert.equal(dimensionsDoNotUpscale({ width: 800, height: 600 }, { width: 801, height: 600 }), false);
  assert.throws(() => inspectImage(png(8000, 6000)), /40-megapixel/);
});

test("file registration is bounded, idempotent, rejects filename byte changes and preserves hash duplicates", async () => {
  const { service } = fixture();
  const batch = await service.createBatch(" Folder 1 ");
  const input = { filename: "Maracas Bay.png", sha256: sha256(sourcePng), bytes: sourcePng.length, contentType: "image/png" as const };
  const first = await service.registerFiles(batch.id, [input]);
  const again = await service.registerFiles(batch.id, [input]);
  assert.equal(first.files.length, 1);
  assert.equal(again.files.length, 1);
  assert.equal(again.files[0].id, first.files[0].id);
  await assert.rejects(
    service.registerFiles(batch.id, [{ ...input, sha256: "a".repeat(64) }]),
    (error: unknown) => error instanceof PhotoImportError && error.status === 409,
  );
  const duplicate = await service.registerFiles(batch.id, [{
    ...input,
    filename: "Maracas Bay copy.png",
  }]);
  assert.equal(duplicate.files.length, 2);
  assert.equal(duplicate.files[1].duplicateOf, duplicate.files[0].id);
  await assert.rejects(service.registerFiles(batch.id, Array.from({ length: 101 }, (_, index) => ({
    ...input,
    filename: `photo-${index}.png`,
  }))), (error: unknown) => error instanceof PhotoImportError && error.status === 400);
});

test("finalize validates source and derivative signatures, declared hashes/dimensions, metadata and no-upscale", async () => {
  const { service, objects } = fixture();
  const batch = await service.createBatch("validation fixtures");
  const good = await addReadyFile(service, objects, batch.id);
  assert.equal(good.status, "ready");

  const declarationBatch = await service.createBatch("declared dimensions");
  await service.registerFiles(declarationBatch.id, [{
    filename: "dimensions.png", sha256: sha256(sourcePng), bytes: sourcePng.length, contentType: "image/png",
  }]);
  const declarationFile = (await service.getBatchResponse(declarationBatch.id)).batch.files[0];
  const declarationSlots = await service.requestUploadUrls(
    declarationBatch.id, declarationFile.id, declaration(cardWebp, 639, 480), declaration(detailWebp, 800, 600),
  );
  if (declarationSlots.ready) throw new Error("Unexpected ready response");
  objects.bytes.set(declarationSlots.original.objectPath, sourcePng);
  objects.bytes.set(declarationSlots.card.objectPath, cardWebp);
  objects.bytes.set(declarationSlots.detail.objectPath, detailWebp);
  await assert.rejects(service.finalize(declarationBatch.id, declarationFile.id), /declaration does not match/);

  const mismatchBatch = await service.createBatch("bad source hash");
  await service.registerFiles(mismatchBatch.id, [{
    filename: "hash.png", sha256: sha256(sourcePng), bytes: sourcePng.length, contentType: "image/png",
  }]);
  const inputFile = (await service.getBatchResponse(mismatchBatch.id)).batch.files[0];
  const mismatchSlots = await service.requestUploadUrls(
    mismatchBatch.id, inputFile.id, declaration(cardWebp, 640, 480), declaration(detailWebp, 800, 600),
  );
  if (mismatchSlots.ready) throw new Error("Unexpected ready response");
  objects.bytes.set(mismatchSlots.original.objectPath, png(799, 600));
  objects.bytes.set(mismatchSlots.card.objectPath, cardWebp);
  objects.bytes.set(mismatchSlots.detail.objectPath, detailWebp);
  await assert.rejects(service.finalize(mismatchBatch.id, inputFile.id), /SHA-256/);
  const failed = (await service.getBatchResponse(mismatchBatch.id)).batch.files[0];
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /SHA-256/);
  const retrySlots = await service.requestUploadUrls(
    mismatchBatch.id, inputFile.id, declaration(cardWebp, 640, 480), declaration(detailWebp, 800, 600),
  );
  if (retrySlots.ready) throw new Error("Failed file must receive fresh slots");
  objects.bytes.set(retrySlots.original.objectPath, sourcePng);
  objects.bytes.set(retrySlots.card.objectPath, cardWebp);
  objects.bytes.set(retrySlots.detail.objectPath, detailWebp);
  assert.equal((await service.finalize(mismatchBatch.id, inputFile.id)).files[0].status, "ready");

  const invalidCases: Array<{ name: string; source: Buffer; sourceType: PhotoImportFileInput["contentType"]; card?: Buffer; detail?: Buffer }> = [
    { name: "corrupt.png", source: Buffer.from("not png"), sourceType: "image/png" },
    { name: "unsupported.png", source: Buffer.from("GIF89a invalid"), sourceType: "image/png" },
    { name: "metadata.png", source: sourcePng, sourceType: "image/png", detail: webp(800, 600, { exif: true }) },
    { name: "upscale.png", source: png(200, 100), sourceType: "image/png", card: webp(201, 100), detail: webp(200, 100) },
  ];
  for (const item of invalidCases) {
    const invalidBatch = await service.createBatch(item.name);
    await service.registerFiles(invalidBatch.id, [{
      filename: item.name,
      sha256: sha256(item.source),
      bytes: item.source.length,
      contentType: item.sourceType,
    }]);
    const file = (await service.getBatchResponse(invalidBatch.id)).batch.files[0];
    const card = item.card ?? cardWebp;
    const detail = item.detail ?? detailWebp;
    const cardDimensions = inspectImage(card);
    const detailDimensions = inspectImage(detail);
    const slots = await service.requestUploadUrls(
      invalidBatch.id, file.id,
      declaration(card, cardDimensions.width, cardDimensions.height),
      declaration(detail, detailDimensions.width, detailDimensions.height),
    );
    if (slots.ready) throw new Error("Unexpected ready response");
    objects.bytes.set(slots.original.objectPath, item.source);
    objects.bytes.set(slots.card.objectPath, card);
    objects.bytes.set(slots.detail.objectPath, detail);
    await assert.rejects(service.finalize(invalidBatch.id, file.id), (error: unknown) =>
      error instanceof PhotoImportError && error.status === 422);
    const recorded = (await service.getBatchResponse(invalidBatch.id)).batch.files[0];
    assert.equal(recorded.status, "failed");
    assert.ok(recorded.error, item.name);
  }
  assert.ok(objects.finalWrites.every(({ path }) => !path.includes("photo-import-staging")));
});

test("review requires complete explicit choices, apply snapshots only photo fields, and restore is idempotent", async () => {
  const { service, objects, repository } = fixture();
  const batch = await service.createBatch("reviewed fixture");
  const file = await addReadyFile(service, objects, batch.id);
  await assert.rejects(service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }], covers: [], excludedFileIds: [],
  }), (error: unknown) => error instanceof PhotoImportError && error.status === 400);
  await assert.rejects(service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }], covers: [{ fileId: file.id, listingId: 2 }], excludedFileIds: [],
  }), (error: unknown) => error instanceof PhotoImportError && error.status === 400);

  const reviewed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  assert.equal(reviewed.status, "reviewed");
  const plan = reviewed.plan!;
  assert.deepEqual(plan.entries[0].before, {
    featuredImage: "/objects/uploads/prior-cover",
    galleryImages: ["/objects/uploads/gallery", "/objects/uploads/prior-cover"],
    photoMedia: null,
  });
  assert.equal(plan.entries[0].after.featuredImage, file.photo!.detail.url);
  assert.equal(plan.entries[0].after.galleryImages![0], file.photo!.detail.url);
  assert.deepEqual(plan.entries[0].after.galleryImages, [
    file.photo!.detail.url,
    "/objects/uploads/gallery",
    "/objects/uploads/prior-cover",
  ]);
  await assert.rejects(service.apply(batch.id, plan.reviewToken, "wrong"), /confirmation/);
  const applied = await service.apply(batch.id, plan.reviewToken, "APPLY REVIEWED PHOTO IMPORT");
  assert.equal(applied.status, "applied");
  assert.equal(repository.listings.get(1)!.status, "draft");
  assert.equal(repository.listings.get(1)!.name, "Maracas Bay");
  assert.equal(repository.listings.get(1)!.photoMedia?.coverSha256, file.sha256);
  assert.equal((await service.apply(batch.id, plan.reviewToken, "APPLY REVIEWED PHOTO IMPORT")).status, "applied");
  const restored = await service.restore(batch.id, "RESTORE PHOTO IMPORT");
  assert.equal(restored.status, "restored");
  assert.equal(repository.listings.get(1)!.featuredImage, "/objects/uploads/prior-cover");
  assert.deepEqual(repository.listings.get(1)!.galleryImages, ["/objects/uploads/gallery", "/objects/uploads/prior-cover"]);
  assert.equal(repository.listings.get(1)!.photoMedia, null);
  assert.equal((await service.restore(batch.id, "RESTORE PHOTO IMPORT")).status, "restored");
});

test("apply and restore compare current media to explicit snapshots and do not overwrite intervening edits", async () => {
  const { service, objects, repository } = fixture();
  const batch = await service.createBatch("cas fixture");
  const file = await addReadyFile(service, objects, batch.id);
  const reviewed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  repository.updateListing(1, { featuredImage: "/objects/uploads/editor-change" });
  await assert.rejects(service.apply(batch.id, reviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT"),
    (error: unknown) => error instanceof PhotoImportError && error.status === 409);
  assert.equal(repository.listings.get(1)!.featuredImage, "/objects/uploads/editor-change");

  const refreshed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  await service.apply(batch.id, refreshed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT");
  repository.updateListing(1, { galleryImages: ["/objects/uploads/concurrent-editor-change"] });
  await assert.rejects(service.restore(batch.id, "RESTORE PHOTO IMPORT"),
    (error: unknown) => error instanceof PhotoImportError && error.status === 409);
  assert.deepEqual(repository.listings.get(1)!.galleryImages, ["/objects/uploads/concurrent-editor-change"]);
});

test("batch lock serialization makes concurrent duplicate apply idempotent", async () => {
  const { service, objects, repository } = fixture();
  const batch = await service.createBatch("concurrency fixture");
  const file = await addReadyFile(service, objects, batch.id);
  const reviewed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  const results = await Promise.all([
    service.apply(batch.id, reviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT"),
    service.apply(batch.id, reviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT"),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["applied", "applied"]);
  assert.equal(repository.batches.get(batch.id)!.status, "applied");
});

test("metadata rejection can recover in the same batch, preserving issue audit without falsely excluding ready photos", async () => {
  const { service, objects } = fixture();
  const batch = await service.createBatch("metadata retry");
  const filename = "Maracas Bay.png";
  const failedDetail = webp(800, 600, { exif: true });
  await assert.rejects(addReadyFile(service, objects, batch.id, { filename, detail: failedDetail }), /metadata/);
  assert.equal(objects.finalWrites.length, 0, "metadata rejection writes no immutable finals");
  const issue = { filename, bytes: sourcePng.length, code: "failed", message: "Display image contains metadata" };
  await service.mergeLocalIssues(batch.id, [issue]);
  const failed = (await service.getBatchResponse(batch.id)).batch.files[0];
  assert.equal(failed.status, "failed");
  const ready = await addReadyFile(service, objects, batch.id, { filename });
  assert.equal(ready.id, failed.id, "retry reuses the registered file");
  assert.equal(ready.status, "ready");
  const recovered = (await service.getBatchResponse(batch.id)).batch;
  assert.deepEqual(recovered.localIssues, [{ ...issue, resolved: true }]);
  const reviewInput = { assignments: [{ fileId: ready.id, listingId: 1 }], covers: [{ fileId: ready.id, listingId: 1 }], excludedFileIds: [] };
  assert.equal((await service.review(batch.id, reviewInput)).status, "reviewed");
  await service.mergeLocalIssues(batch.id, [{ ...issue, message: "Different content", code: "changed" }]);
  await assert.rejects(service.review(batch.id, reviewInput), /acknowledge/);
});

test("late metadata report is resolved only by matching ready filename and bytes; clients cannot resolve issues", async () => {
  const { service, objects } = fixture();
  const batch = await service.createBatch("late reports");
  const ready = await addReadyFile(service, objects, batch.id);
  const issue = { filename: ready.filename, bytes: ready.bytes, code: "failed", message: "Display image contains metadata" };
  const result = await service.mergeLocalIssues(batch.id, [
    issue,
    { ...issue, bytes: ready.bytes + 1, resolved: true },
    { ...issue, filename: "unknown.png", resolved: true },
    { ...issue, message: "Source changed", code: "changed", resolved: true },
  ]);
  assert.equal(result.localIssues![0].resolved, true);
  assert.ok(result.localIssues!.slice(1).every((record) => record.resolved !== true));
});

test("matching remains exact/sequence-only and duplicate listing names are explicitly ambiguous", async () => {
  const { service, repository } = fixture();
  repository.listings.set(2, { ...repository.listings.get(1)!, id: 2 });
  const batch = await service.createBatch("matches");
  const registered = await service.registerFiles(batch.id, [
    { filename: "Maracas Bay 01.png", sha256: "a".repeat(64), bytes: 1, contentType: "image/png" },
    { filename: "unknown-alias.png", sha256: "b".repeat(64), bytes: 1, contentType: "image/png" },
  ]);
  const response = await service.getBatchResponse(batch.id);
  assert.equal(response.matches[registered.files[0].id].status, "ambiguous");
  assert.deepEqual(response.matches[registered.files[0].id].candidateIds, [1, 2]);
  assert.equal(response.matches[registered.files[0].id].sequence, 1);
  assert.equal(response.matches[registered.files[1].id].status, "no_match");
});

test("local browser issues and source totals are durable, idempotent and explicitly acknowledged before review", async () => {
  const { service, objects } = fixture();
  const batch = await service.createBatch("durable browser reports");
  const file = await addReadyFile(service, objects, batch.id);
  const issue = {
    filename: "unsupported.gif",
    bytes: 2048,
    code: "unsupported_format",
    message: "Animated GIF is not supported",
  };
  const totals = { selectedFiles: 2, selectedBytes: sourcePng.length + issue.bytes };
  const recorded = await service.mergeLocalIssues(batch.id, [issue], totals);
  assert.deepEqual(recorded.localIssues, [issue]);
  assert.deepEqual(recorded.sourceTotals, totals);
  assert.equal(recorded.files.length, 1, "local issues do not become implicit registered/excluded files");
  const repeated = await service.mergeLocalIssues(batch.id, [issue], totals);
  assert.deepEqual(repeated.localIssues, [issue]);
  assert.deepEqual((await service.getBatchResponse(batch.id)).batch.localIssues, [issue]);
  await assert.rejects(service.mergeLocalIssues(batch.id, Array.from({ length: 101 }, (_, index) => ({
    filename: `bad-${index}.gif`, bytes: 1, code: "unsupported", message: "Unsupported",
  }))), (error: unknown) => error instanceof PhotoImportError && error.status === 400);

  const reviewInput = {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  };
  await assert.rejects(service.review(batch.id, reviewInput),
    (error: unknown) => error instanceof PhotoImportError && /acknowledge/.test(error.message));
  const reviewed = await service.review(batch.id, { ...reviewInput, acknowledgeLocalIssues: true });
  assert.equal(reviewed.localIssuesAcknowledged, true);
  assert.equal(reviewed.status, "reviewed");
  const changed = await service.mergeLocalIssues(batch.id, [{
    filename: "oversize.jpg", bytes: 60 * 1024 * 1024, code: "oversize", message: "Source exceeds 50 MiB",
  }]);
  assert.equal(changed.status, "staging");
  assert.equal(changed.plan, null);
  assert.equal(changed.localIssuesAcknowledged, false);
  const reReviewed = await service.review(batch.id, { ...reviewInput, acknowledgeLocalIssues: true });
  const applied = await service.apply(batch.id, reReviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT");
  assert.equal(applied.localIssues?.length, 2);
  await assert.rejects(service.mergeLocalIssues(batch.id, []),
    (error: unknown) => error instanceof PhotoImportError && error.status === 409);
});

test("photoMedia public schema/projection is safe and listing editors cannot forge or stale-overwrite it", async () => {
  const { service, objects, repository } = fixture();
  const batch = await service.createBatch("projection");
  const file = await addReadyFile(service, objects, batch.id);
  const reviewed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  await service.apply(batch.id, reviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT");
  const listing = repository.listings.get(1)!;
  const publicRow = publicListing({
    ...listing,
    importKey: "private",
    importDetails: { batchId: 1, fileName: "private", sheet: "x", rowNumber: 1, verified: false, warnings: [], rawColumns: {} },
  } as Listing);
  assert.deepEqual(publicRow.photoMedia, listing.photoMedia);
  assert.equal("status" in publicRow, false);
  assert.equal(photoMediaSchema.safeParse(listing.photoMedia).success, true);
  assert.equal(safePhotoMedia({ version: 1, coverSha256: null, photos: [{ sourceSha256: "x" }] }), null);
  const withExtra = { ...listing.photoMedia!, internalNote: "must be stripped" };
  const stripped = safePhotoMedia(withExtra)!;
  assert.equal("internalNote" in stripped, false);
  assert.equal(listingPhotoWriteError({ photoMedia: listing.photoMedia }, listing as Listing), null);
  assert.match(listingPhotoWriteError({ photoMedia: null }, listing as Listing) ?? "", /managed/);
  assert.match(listingPhotoWriteError({ photoMedia: listing.photoMedia }), /only be set/);
  assert.match(listingPhotoWriteError({ featuredImage: "/objects/originals/private" }, listing as Listing) ?? "", /Private/);
  assert.match(listingPhotoWriteError({ featuredImage: "/objects/display/photo-imports/forged" }, listing as Listing) ?? "", /[Mm]alformed/);
  assert.equal(listingPhotoWriteError({ galleryImages: ["/objects/uploads/legacy"] }, listing as Listing), null);
});

test("ordinary image edits reconcile photoMedia, cover inference and public authorization to effective refs", async () => {
  const { service, objects, repository } = fixture();
  const batch = await service.createBatch("reconciliation");
  const file = await addReadyFile(service, objects, batch.id);
  const reviewed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  await service.apply(batch.id, reviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT");
  const appliedListing = repository.listings.get(1)!;

  const staleGalleryEdit = reconcileListingPhotoPatch(
    { featuredImage: "/objects/uploads/new-legacy-cover", galleryImages: ["/objects/uploads/legacy-only"] },
    appliedListing as Listing,
  );
  assert.deepEqual(staleGalleryEdit.galleryImages, ["/objects/uploads/legacy-only"]);
  assert.equal(staleGalleryEdit.photoMedia, null);
  const staleStoredMetadata = {
    ...appliedListing,
    featuredImage: "/objects/uploads/legacy-only",
    galleryImages: ["/objects/uploads/legacy-only"],
  } as Listing;
  assert.match(
    listingPhotoWriteError({ featuredImage: file.photo!.detail.url }, staleStoredMetadata) ?? "",
    /validated photo media/,
  );

  const featureChanged = reconcileListingPhotoPatch(
    { featuredImage: "/objects/uploads/new-legacy-cover" },
    appliedListing as Listing,
  );
  assert.equal(featureChanged.photoMedia?.photos.length, 1);
  assert.equal(featureChanged.photoMedia?.coverSha256, null);
  assert.equal(reconcilePhotoMedia(
    "/objects/uploads/new-legacy-cover",
    ["/objects/uploads/legacy-only"],
    appliedListing.photoMedia,
  ), null);

  const unreferencedProjection = publicListing({
    ...appliedListing,
    featuredImage: "/objects/uploads/other-cover",
    galleryImages: ["/objects/uploads/other-gallery"],
  } as Listing);
  assert.equal(unreferencedProjection.photoMedia, null);
});

test("editor photo CAS requires a current snapshot for media changes while core-only patches preserve photos", async () => {
  const { service, objects, repository } = fixture();
  const batch = await service.createBatch("editor CAS");
  const file = await addReadyFile(service, objects, batch.id);
  const reviewed = await service.review(batch.id, {
    assignments: [{ fileId: file.id, listingId: 1 }],
    covers: [{ fileId: file.id, listingId: 1 }],
    excludedFileIds: [],
  });
  await service.apply(batch.id, reviewed.plan!.reviewToken, "APPLY REVIEWED PHOTO IMPORT");
  const current = repository.listings.get(1)! as Listing;
  const expectedMedia = {
    featuredImage: current.featuredImage,
    galleryImages: current.galleryImages,
    photoMedia: current.photoMedia,
  };
  const changedPhotos = {
    featuredImage: "/objects/uploads/editor-cover",
    galleryImages: ["/objects/uploads/editor-cover"],
  };

  const missing = prepareGuardedListingPatch(changedPhotos, current);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 428);
  const stale = prepareGuardedListingPatch(changedPhotos, current, {
    ...expectedMedia,
    featuredImage: "/objects/uploads/stale-cover",
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.status, 409);

  const accepted = prepareGuardedListingPatch(changedPhotos, current, expectedMedia);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.data.photoMedia, null);

  const coreOnly = prepareGuardedListingPatch({ description: "Edited description" }, current);
  assert.equal(coreOnly.ok, true);
  if (coreOnly.ok) {
    assert.equal("featuredImage" in coreOnly.data, false);
    assert.equal("galleryImages" in coreOnly.data, false);
    assert.equal("photoMedia" in coreOnly.data, false);
    assert.equal({ ...current, ...coreOnly.data }.photoMedia?.coverSha256, current.photoMedia?.coverSha256);
  }
});