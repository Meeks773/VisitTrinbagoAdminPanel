import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  LocalPhotoImportIssue,
  MediaSnapshot,
  PhotoImportBatch,
  PhotoImportBatchResponse,
  PhotoImportFile,
  PhotoImportFileInput,
  PhotoImportPlan,
  PhotoImportPlanEntry,
  PhotoMatch,
  PhotoImportSourceTotals,
  ReviewPhotoImportInput,
  VariantDeclaration,
} from "@shared/photo-import-types";
import { photoMediaSchema, safePhotoMedia, type PhotoMedia, type PublicPlacePhoto } from "@shared/photo-media";
import type { PhotoImportRepository, PhotoImportTransaction, PhotoImportListing } from "./repository";
import { PhotoImportError } from "./repository";
import {
  dimensionsDoNotUpscale,
  ImageValidationError,
  inspectImage,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_PIXELS,
  MAX_VARIANT_BYTES,
  sha256,
  validateImageBytes,
  type ImageFormat,
  type ImageInspection,
} from "./image-validation";
import { reconcilePhotoMedia } from "./media-reconciliation";

export type PhotoUploadKind = "original" | "card" | "detail";
export interface PhotoImportObjectStorage {
  createStagingUpload(batchId: string, fileId: string, kind: PhotoUploadKind): Promise<{ uploadURL: string; objectPath: string }>;
  readPrivateObject(path: string, maxBytes: number): Promise<Buffer>;
  putImmutablePrivateObject(path: string, bytes: Buffer, contentType: string): Promise<void>;
}

export interface PhotoImportServiceDependencies {
  repository: PhotoImportRepository;
  objects: PhotoImportObjectStorage;
  now?: () => Date;
  newId?: () => string;
}

const MIME_TO_FORMAT: Record<PhotoImportFileInput["contentType"], ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
const FORMAT_TO_MIME: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const MAX_LOCAL_ISSUES = 2500;

function asFile(input: unknown): PhotoImportFileInput {
  if (!input || typeof input !== "object") throw new PhotoImportError("Each file must provide valid image metadata", 400);
  const value = input as Record<string, unknown>;
  if (
    typeof value.filename !== "string" || !value.filename.trim() || value.filename.length > 255 ||
    /[\\/\0-\x1f\x7f]/.test(value.filename) ||
    typeof value.sha256 !== "string" || !SHA_PATTERN.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > MAX_SOURCE_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(value.contentType))
  ) {
    throw new PhotoImportError("Each file must have a safe filename, SHA-256, supported MIME type and size no greater than 50 MiB", 400);
  }
  return {
    filename: value.filename,
    sha256: value.sha256,
    bytes: Number(value.bytes),
    contentType: value.contentType as PhotoImportFileInput["contentType"],
  };
}

function validateVariantDeclaration(value: unknown, label: string): VariantDeclaration {
  if (!value || typeof value !== "object") throw new PhotoImportError(`A valid ${label} image declaration is required`, 400);
  const declaration = value as Record<string, unknown>;
  if (
    typeof declaration.sha256 !== "string" || !SHA_PATTERN.test(declaration.sha256) ||
    !Number.isSafeInteger(declaration.bytes) || Number(declaration.bytes) < 1 || Number(declaration.bytes) > MAX_VARIANT_BYTES ||
    !Number.isSafeInteger(declaration.width) || Number(declaration.width) < 1 ||
    !Number.isSafeInteger(declaration.height) || Number(declaration.height) < 1 ||
    !["webp", "jpeg"].includes(String(declaration.format))
  ) {
    throw new PhotoImportError(`A valid ${label} image declaration is required`, 400);
  }
  return declaration as unknown as VariantDeclaration;
}

function parseLocalIssue(value: unknown) {
  if (!value || typeof value !== "object") throw new PhotoImportError("Each local issue must be a bounded file report", 400);
  const issue = value as Record<string, unknown>;
  if (
    typeof issue.filename !== "string" || !issue.filename.trim() || issue.filename.length > 255 ||
    /[\\/\0-\x1f\x7f]/.test(issue.filename) ||
    !Number.isSafeInteger(issue.bytes) || Number(issue.bytes) < 0 ||
    typeof issue.code !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(issue.code) ||
    typeof issue.message !== "string" || !issue.message.trim() || issue.message.length > 500 ||
    /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(issue.message)
  ) {
    throw new PhotoImportError("Local issues require a safe filename, byte count, code and message", 400);
  }
  return {
    filename: issue.filename,
    bytes: Number(issue.bytes),
    code: issue.code,
    message: issue.message.trim(),
  };
}

function parseSourceTotals(value: unknown): PhotoImportSourceTotals {
  if (!value || typeof value !== "object") throw new PhotoImportError("sourceTotals must contain selectedFiles and selectedBytes", 400);
  const totals = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(totals.selectedFiles) || Number(totals.selectedFiles) < 0 || Number(totals.selectedFiles) > MAX_LOCAL_ISSUES ||
    !Number.isSafeInteger(totals.selectedBytes) || Number(totals.selectedBytes) < 0
  ) {
    throw new PhotoImportError("sourceTotals are outside the supported range", 400);
  }
  return { selectedFiles: Number(totals.selectedFiles), selectedBytes: Number(totals.selectedBytes) };
}

function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function filenameStem(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function matchesFor(batch: PhotoImportBatch, catalog: PhotoImportBatchResponse["catalog"]): Record<string, PhotoMatch> {
  const byFilename = new Map<string, number>();
  for (const file of batch.files) byFilename.set(file.filename, (byFilename.get(file.filename) ?? 0) + 1);
  const normalizedCatalog = catalog.map((place) => ({ place, name: normalizedName(place.name) }));
  const matches: Record<string, PhotoMatch> = {};
  for (const file of batch.files) {
    const stem = normalizedName(filenameStem(file.filename));
    const exact = normalizedCatalog.filter(({ name }) => name === stem).map(({ place }) => place.id);
    let ids = exact;
    let sequence: number | null = null;
    if (!ids.length) {
      const numbered = /^(.*?)[\s_-]+(\d+)$/.exec(stem);
      if (numbered) {
        sequence = Number(numbered[2]);
        ids = normalizedCatalog.filter(({ name }) => name === numbered[1]).map(({ place }) => place.id);
      }
    }
    const ambiguousDuplicateFilename = (byFilename.get(file.filename) ?? 0) > 1;
    matches[file.id] = ids.length === 1 && !ambiguousDuplicateFilename
      ? { status: "candidate", candidateIds: ids, sequence }
      : ids.length > 0 || ambiguousDuplicateFilename
        ? { status: "ambiguous", candidateIds: ids, sequence }
        : { status: "no_match", candidateIds: [], sequence };
  }
  return matches;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(listing: PhotoImportListing): MediaSnapshot {
  const validated = safePhotoMedia(listing.photoMedia);
  if (listing.photoMedia != null && !validated) {
    throw new PhotoImportError(`Listing ${listing.id} has invalid photo media and must be reconciled before import`, 409);
  }
  return {
    featuredImage: listing.featuredImage,
    galleryImages: listing.galleryImages ? [...listing.galleryImages] : null,
    photoMedia: reconcilePhotoMedia(listing.featuredImage, listing.galleryImages, validated),
  };
}

function snapshotsEqual(left: MediaSnapshot, right: MediaSnapshot): boolean {
  return canonical(left) === canonical(right);
}

function fileById(batch: PhotoImportBatch, id: string): PhotoImportFile {
  const file = batch.files.find((candidate) => candidate.id === id);
  if (!file) throw new PhotoImportError("Photo import file not found", 404);
  return file;
}

function variantMetadataMatches(actual: ImageInspection, declared: VariantDeclaration, bytes: Buffer): boolean {
  return actual.format === (declared.format === "jpeg" ? "jpeg" : "webp") &&
    declared.sha256 === sha256(bytes) &&
    declared.bytes === bytes.length &&
    declared.width === actual.width &&
    declared.height === actual.height;
}

function assertDeclarationMatches(actual: ImageInspection, declaration: VariantDeclaration, bytes: Buffer, label: string) {
  if (!variantMetadataMatches(actual, declaration, bytes)) {
    throw new ImageValidationError(`${label} declaration does not match the uploaded image bytes`);
  }
}

function buildPhotoMedia(
  before: MediaSnapshot,
  selected: PhotoImportFile[],
  cover: PhotoImportFile,
): MediaSnapshot {
  const existing = before.photoMedia;
  const importedOrder = [cover, ...selected.filter((file) => file.id !== cover.id)];
  const importedByHash = new Map<string, PublicPlacePhoto>();
  for (const file of importedOrder) {
    if (!file.photo) throw new PhotoImportError("Only validated ready photos can be applied", 409);
        if (!importedByHash.has(file.photo.sourceSha256)) {
          importedByHash.set(file.photo.sourceSha256, file.photo);
        }
  }
  const photos = [...importedByHash.values()];
  for (const photo of existing?.photos ?? []) {
    if (!importedByHash.has(photo.sourceSha256)) {
      importedByHash.set(photo.sourceSha256, photo);
      photos.push(photo);
    }
  }
  if (photos.length > 2500) {
    throw new PhotoImportError("Listing photo media would exceed the 2,500-photo limit", 413);
  }
  const media: PhotoMedia = {
    version: 1,
    coverSha256: cover.sha256,
    photos,
  };
  const validatedMedia = photoMediaSchema.parse(media);
  const allPhotos = [...photos];
  const hashByDetail = new Map(allPhotos.map((photo) => [photo.detail.url, photo.sourceSha256]));
  const galleryImages: string[] = [];
  const refs = new Set<string>();
  const hashes = new Set<string>();
  const candidates = [
    ...importedOrder.map((file) => file.photo!.detail.url),
    ...(before.galleryImages ?? []),
    ...(before.featuredImage ? [before.featuredImage] : []),
    ...(existing?.photos.map((photo) => photo.detail.url) ?? []),
  ];
  for (const ref of candidates) {
    if (!ref || refs.has(ref)) continue;
    const hash = hashByDetail.get(ref);
    if (hash && hashes.has(hash)) continue;
    refs.add(ref);
    if (hash) hashes.add(hash);
    galleryImages.push(ref);
  }
  return {
    photoMedia: validatedMedia,
    featuredImage: cover.photo!.detail.url,
    galleryImages,
  };
}

export class PhotoImportService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly dependencies: PhotoImportServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.newId = dependencies.newId ?? randomUUID;
  }

  async listBatches() {
    return this.dependencies.repository.listBatches();
  }

  async createBatch(rawName: unknown): Promise<PhotoImportBatch> {
    if (typeof rawName !== "string" || !rawName.trim() || rawName.trim().length > 200) {
      throw new PhotoImportError("Batch name must be between 1 and 200 characters", 400);
    }
    const timestamp = this.now().toISOString();
    const batch: PhotoImportBatch = {
      id: this.newId(),
      name: rawName.trim(),
      status: "staging",
      createdAt: timestamp,
      updatedAt: timestamp,
      files: [],
      plan: null,
    };
    await this.dependencies.repository.createBatch(batch);
    return batch;
  }

  async getBatchResponse(id: string): Promise<PhotoImportBatchResponse> {
    const batch = await this.dependencies.repository.getBatch(id);
    if (!batch) throw new PhotoImportError("Photo import batch not found", 404);
    const catalog = await this.dependencies.repository.getCatalog();
    return { batch, catalog, matches: matchesFor(batch, catalog) };
  }

  async registerFiles(id: string, rawFiles: unknown): Promise<PhotoImportBatch> {
    if (!Array.isArray(rawFiles) || rawFiles.length < 1 || rawFiles.length > 100) {
      throw new PhotoImportError("Register between 1 and 100 files per request", 400);
    }
    const inputs = rawFiles.map(asFile);
    return this.dependencies.repository.withBatch(id, async (tx) => {
      if (tx.batch.status !== "staging") throw new PhotoImportError("Files can only be registered while a batch is staging", 409);
      const seenInRequest = new Map<string, PhotoImportFileInput>();
      for (const input of inputs) {
        const requestPrior = seenInRequest.get(input.filename);
        if (requestPrior && (requestPrior.sha256 !== input.sha256 || requestPrior.bytes !== input.bytes)) {
          throw new PhotoImportError(`Filename "${input.filename}" is repeated with different bytes`, 409);
        }
        seenInRequest.set(input.filename, input);
        const existing = tx.batch.files.find((file) => file.filename === input.filename);
        if (existing && (existing.sha256 !== input.sha256 || existing.bytes !== input.bytes || existing.contentType !== input.contentType)) {
          throw new PhotoImportError(`Filename "${input.filename}" already exists with different source bytes`, 409);
        }
      }
      for (const input of inputs) {
        if (tx.batch.files.some((file) => file.filename === input.filename)) continue;
        if (tx.batch.files.length >= 2500) throw new PhotoImportError("A photo import batch cannot exceed 2,500 files", 413);
        const duplicate = tx.batch.files.find((file) => file.sha256 === input.sha256);
        tx.batch.files.push({
          ...input,
          id: this.newId(),
          status: "pending",
          error: null,
          originalPath: null,
          photo: null,
          duplicateOf: duplicate?.id ?? null,
        });
      }
      await tx.save();
      return tx.batch;
    });
  }

  async mergeLocalIssues(
    id: string,
    rawIssues: unknown,
    rawSourceTotals?: unknown,
  ): Promise<PhotoImportBatch> {
    if (!Array.isArray(rawIssues) || rawIssues.length > 100) {
      throw new PhotoImportError("Submit no more than 100 local file issues per request", 400);
    }
    const issues = rawIssues.map(parseLocalIssue);
    const sourceTotals = rawSourceTotals === undefined ? undefined : parseSourceTotals(rawSourceTotals);
    return this.dependencies.repository.withBatch(id, async (tx) => {
      if (tx.batch.status === "applied" || tx.batch.status === "restored") {
        throw new PhotoImportError("Local import reports cannot change after apply or restore", 409);
      }
      const merged = [...(tx.batch.localIssues ?? [])];
      const keys = new Set(merged.map((issue) => `${issue.filename}\0${issue.code}\0${issue.bytes}`));
      let changed = false;
      for (const issue of issues) {
        const key = `${issue.filename}\0${issue.code}\0${issue.bytes}`;
        if (keys.has(key)) continue;
        if (merged.length >= MAX_LOCAL_ISSUES) throw new PhotoImportError("A batch cannot exceed 2,500 local issues", 413);
        keys.add(key);
        merged.push(issue);
        changed = true;
      }
      if (JSON.stringify(sourceTotals) !== JSON.stringify(tx.batch.sourceTotals) && sourceTotals !== undefined) {
        tx.batch.sourceTotals = sourceTotals;
        changed = true;
      }
      if (changed) {
        tx.batch.localIssues = merged;
        tx.batch.localIssuesAcknowledged = false;
        tx.batch.plan = null;
        if (tx.batch.status === "reviewed") tx.batch.status = "staging";
        await tx.save();
      }
      return tx.batch;
    });
  }

  async requestUploadUrls(id: string, fileId: string, rawCard: unknown, rawDetail: unknown) {
    const cardDeclaration = validateVariantDeclaration(rawCard, "card");
    const detailDeclaration = validateVariantDeclaration(rawDetail, "detail");
    if (Math.max(cardDeclaration.width, cardDeclaration.height) > 640) {
      throw new PhotoImportError("Card images must fit within 640 pixels", 400);
    }
    if (Math.max(detailDeclaration.width, detailDeclaration.height) > 1600) {
      throw new PhotoImportError("Detail images must fit within 1,600 pixels", 400);
    }
    return this.dependencies.repository.withBatch(id, async (tx) => {
      if (tx.batch.status !== "staging") throw new PhotoImportError("Uploads are only allowed while a batch is staging", 409);
      const file = fileById(tx.batch, fileId);
      if (file.status === "ready") return { ready: true as const, file };
      const slots = await Promise.all([
        this.dependencies.objects.createStagingUpload(id, fileId, "original"),
        this.dependencies.objects.createStagingUpload(id, fileId, "card"),
        this.dependencies.objects.createStagingUpload(id, fileId, "detail"),
      ]);
      file.reservation = {
        original: slots[0].objectPath,
        card: slots[1].objectPath,
        detail: slots[2].objectPath,
        cardDeclaration,
        detailDeclaration,
      };
      file.status = "pending";
      file.error = null;
      await tx.save();
      return {
        ready: false as const,
        original: slots[0],
        card: slots[1],
        detail: slots[2],
      };
    });
  }

  async finalize(id: string, fileId: string): Promise<PhotoImportBatch> {
    const outcome = await this.dependencies.repository.withBatch(id, async (tx) => {
      if (tx.batch.status !== "staging") throw new PhotoImportError("Files can only be finalized while a batch is staging", 409);
      const file = fileById(tx.batch, fileId);
      if (file.status === "ready") return { batch: tx.batch, error: null as string | null };
      try {
        if (!file.reservation) throw new ImageValidationError("Request upload URLs before finalizing this file");
        const { reservation } = file;
        const [original, card, detail] = await Promise.all([
          this.dependencies.objects.readPrivateObject(reservation.original, MAX_SOURCE_BYTES),
          this.dependencies.objects.readPrivateObject(reservation.card, MAX_VARIANT_BYTES),
          this.dependencies.objects.readPrivateObject(reservation.detail, MAX_VARIANT_BYTES),
        ]);
        if (original.length !== file.bytes || sha256(original) !== file.sha256) {
          throw new ImageValidationError("Original image byte size or SHA-256 does not match the registered source");
        }
        const sourceInspection = validateImageBytes(original, {
          maxBytes: MAX_SOURCE_BYTES,
          allowedFormats: ["jpeg", "png", "webp"],
        });
        if (FORMAT_TO_MIME[sourceInspection.format] !== file.contentType) {
          throw new ImageValidationError("Original image signature does not match its declared MIME type");
        }
        const cardInspection = validateImageBytes(card, {
          maxBytes: MAX_VARIANT_BYTES,
          allowedFormats: ["jpeg", "webp"],
          requireMetadataFree: true,
        });
        const detailInspection = validateImageBytes(detail, {
          maxBytes: MAX_VARIANT_BYTES,
          allowedFormats: ["jpeg", "webp"],
          requireMetadataFree: true,
        });
        assertDeclarationMatches(cardInspection, reservation.cardDeclaration, card, "Card");
        assertDeclarationMatches(detailInspection, reservation.detailDeclaration, detail, "Detail");
        if (Math.max(cardInspection.width, cardInspection.height) > 640) {
          throw new ImageValidationError("Card image exceeds the 640-pixel fit");
        }
        if (Math.max(detailInspection.width, detailInspection.height) > 1600) {
          throw new ImageValidationError("Detail image exceeds the 1,600-pixel fit");
        }
        if (!dimensionsDoNotUpscale(sourceInspection, cardInspection) ||
            !dimensionsDoNotUpscale(sourceInspection, detailInspection)) {
          throw new ImageValidationError("Display image dimensions upscale the source image");
        }
        const extension = (format: "jpeg" | "webp") => format === "jpeg" ? "jpg" : "webp";
        const originalPath = `/objects/originals/photo-imports/${id}/${fileId}/${file.sha256}`;
        const cardPath = `/objects/display/photo-imports/${id}/${fileId}/${reservation.cardDeclaration.sha256}.${extension(reservation.cardDeclaration.format)}`;
        const detailPath = `/objects/display/photo-imports/${id}/${fileId}/${reservation.detailDeclaration.sha256}.${extension(reservation.detailDeclaration.format)}`;
        await Promise.all([
          this.putValidatedObject(originalPath, original, file.contentType),
          this.putValidatedObject(cardPath, card, FORMAT_TO_MIME[cardInspection.format]),
          this.putValidatedObject(detailPath, detail, FORMAT_TO_MIME[detailInspection.format]),
        ]);
        file.originalPath = originalPath;
        file.photo = {
          sourceSha256: file.sha256,
          card: {
            url: cardPath,
            sha256: reservation.cardDeclaration.sha256,
            bytes: card.length,
            width: cardInspection.width,
            height: cardInspection.height,
            format: reservation.cardDeclaration.format,
          },
          detail: {
            url: detailPath,
            sha256: reservation.detailDeclaration.sha256,
            bytes: detail.length,
            width: detailInspection.width,
            height: detailInspection.height,
            format: reservation.detailDeclaration.format,
          },
        };
        file.status = "ready";
        file.error = null;
        return { batch: tx.batch, error: null as string | null };
      } catch (error) {
        const message = error instanceof ImageValidationError
          ? error.message
          : "Could not validate and finalize the staged photo. Request fresh upload URLs and retry.";
        file.status = "failed";
        file.error = message;
        await tx.save();
        return { batch: tx.batch, error: message };
      } finally {
        if (file.status === "ready") await tx.save();
      }
    });
    if (outcome.error) throw new PhotoImportError(outcome.error, 422);
    return outcome.batch;
  }

  private async putValidatedObject(path: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.dependencies.objects.putImmutablePrivateObject(path, bytes, contentType);
    // An idempotent retry can meet an immutable object from an earlier partial
    // finalize; verify the final bytes before marking the file ready.
    const stored = await this.dependencies.objects.readPrivateObject(path, bytes.length);
    if (stored.length !== bytes.length || sha256(stored) !== sha256(bytes)) {
      throw new ImageValidationError("Final immutable image object did not match the validated bytes");
    }
  }

  async review(id: string, input: ReviewPhotoImportInput): Promise<PhotoImportBatch> {
    return this.dependencies.repository.withBatch(id, async (tx) => {
      if (!["staging", "reviewed"].includes(tx.batch.status)) {
        throw new PhotoImportError("An applied or restored batch cannot be reviewed again", 409);
      }
      if (input?.acknowledgeLocalIssues !== undefined && typeof input.acknowledgeLocalIssues !== "boolean") {
        throw new PhotoImportError("acknowledgeLocalIssues must be a boolean when provided", 400);
      }
      if ((tx.batch.localIssues?.length ?? 0) > 0 && input?.acknowledgeLocalIssues !== true) {
        throw new PhotoImportError("Explicitly acknowledge all saved local file issues before review", 400);
      }
      if (!input || !Array.isArray(input.assignments) || !Array.isArray(input.covers) || !Array.isArray(input.excludedFileIds)) {
        throw new PhotoImportError("Provide assignments, cover choices and explicit exclusions", 400);
      }
      const fileIds = new Set(tx.batch.files.map((file) => file.id));
      const assigned = new Map<string, number>();
      for (const assignment of input.assignments) {
        if (!assignment || !fileIds.has(assignment.fileId) || !Number.isSafeInteger(assignment.listingId) || assignment.listingId < 1 ||
            assigned.has(assignment.fileId)) {
          throw new PhotoImportError("Assignments must contain each file at most once and reference valid listings", 400);
        }
        assigned.set(assignment.fileId, assignment.listingId);
      }
      const excluded = new Set(input.excludedFileIds);
      if (excluded.size !== input.excludedFileIds.length || [...excluded].some((fileId) => !fileIds.has(fileId))) {
        throw new PhotoImportError("Exclusions must reference each batch file at most once", 400);
      }
      if (assigned.size + excluded.size !== tx.batch.files.length ||
          tx.batch.files.some((file) => assigned.has(file.id) === excluded.has(file.id))) {
        throw new PhotoImportError("Every batch file must be explicitly assigned or excluded, but not both", 400);
      }
      for (const fileId of assigned.keys()) {
        if (fileById(tx.batch, fileId).status !== "ready") {
          throw new PhotoImportError("Only finalized ready photos can be assigned; exclude unfinished files explicitly", 400);
        }
      }
      const filesByListing = new Map<number, string[]>();
      for (const [fileId, listingId] of assigned) {
        const group = filesByListing.get(listingId) ?? [];
        group.push(fileId);
        filesByListing.set(listingId, group);
      }
      const coverByListing = new Map<number, string>();
      for (const cover of input.covers) {
        if (!cover || !filesByListing.has(cover.listingId) || !assigned.has(cover.fileId) ||
            assigned.get(cover.fileId) !== cover.listingId || coverByListing.has(cover.listingId)) {
          throw new PhotoImportError("Each cover must be a unique assigned photo for its listing", 400);
        }
        coverByListing.set(cover.listingId, cover.fileId);
      }
      if (coverByListing.size !== filesByListing.size) {
        throw new PhotoImportError("Choose an explicit cover photo for every assigned listing", 400);
      }
      const listingIds = [...filesByListing.keys()].sort((a, b) => a - b);
      const listings = await tx.lockListings(listingIds);
      const listingsById = new Map(listings.map((listing) => [listing.id, listing]));
      if (listingsById.size !== listingIds.length) throw new PhotoImportError("One or more assigned listings no longer exist", 409);
      const entries: PhotoImportPlanEntry[] = [];
      for (const listingId of listingIds) {
        const listing = listingsById.get(listingId)!;
        const before = snapshot(listing);
        const fileGroup = filesByListing.get(listingId)!;
        const selected = fileGroup.map((fileId) => fileById(tx.batch, fileId));
        const cover = fileById(tx.batch, coverByListing.get(listingId)!);
        const after = buildPhotoMedia(before, selected, cover);
        entries.push({
          listingId,
          listingName: listing.name,
          fileIds: fileGroup,
          coverFileId: cover.id,
          before,
          after,
        });
      }
      tx.batch.plan = {
        reviewToken: this.newId(),
        createdAt: this.now().toISOString(),
        entries,
        excludedFileIds: [...excluded],
      };
      tx.batch.status = "reviewed";
      tx.batch.localIssuesAcknowledged = true;
      tx.batch.report = undefined;
      await tx.save();
      return tx.batch;
    });
  }

  async apply(id: string, reviewToken: string, confirmation: string): Promise<PhotoImportBatch> {
    if (confirmation !== "APPLY REVIEWED PHOTO IMPORT") throw new PhotoImportError("Explicit apply confirmation is required", 400);
    return this.dependencies.repository.withBatch(id, async (tx) => {
      const plan = tx.batch.plan;
      if (!plan || plan.reviewToken !== reviewToken) throw new PhotoImportError("Review token is stale; refresh and review the batch again", 409);
      if (tx.batch.status === "applied") return tx.batch;
      if (tx.batch.status !== "reviewed") throw new PhotoImportError("Only a reviewed batch can be applied", 409);
      const ids = plan.entries.map((entry) => entry.listingId);
      const rows = await tx.lockListings(ids);
      const byId = new Map(rows.map((listing) => [listing.id, listing]));
      if (byId.size !== new Set(ids).size) throw new PhotoImportError("One or more listings no longer exist", 409);
      for (const entry of plan.entries) {
        const current = snapshot(byId.get(entry.listingId)!);
        if (!snapshotsEqual(current, entry.before)) {
          throw new PhotoImportError(`Listing ${entry.listingId} photo fields changed since review; refresh and review again`, 409);
        }
      }
      for (const entry of plan.entries) await tx.updateListingMedia(entry.listingId, entry.after);
      tx.batch.status = "applied";
      tx.batch.report = {
        appliedAt: this.now().toISOString(),
        listingCount: plan.entries.length,
        photoCount: plan.entries.reduce((count, entry) => count + entry.fileIds.length, 0),
      };
      await tx.save();
      return tx.batch;
    });
  }

  async restore(id: string, confirmation: string): Promise<PhotoImportBatch> {
    if (confirmation !== "RESTORE PHOTO IMPORT") throw new PhotoImportError("Explicit restore confirmation is required", 400);
    return this.dependencies.repository.withBatch(id, async (tx) => {
      if (tx.batch.status === "restored") return tx.batch;
      const plan = tx.batch.plan;
      if (!plan || tx.batch.status !== "applied") throw new PhotoImportError("Only an applied batch can be restored", 409);
      const rows = await tx.lockListings(plan.entries.map((entry) => entry.listingId));
      const byId = new Map(rows.map((listing) => [listing.id, listing]));
      if (byId.size !== new Set(plan.entries.map((entry) => entry.listingId)).size) {
        throw new PhotoImportError("One or more listings no longer exist", 409);
      }
      for (const entry of plan.entries) {
        const current = snapshot(byId.get(entry.listingId)!);
        if (!snapshotsEqual(current, entry.after)) {
          throw new PhotoImportError(`Listing ${entry.listingId} photo fields changed since apply; restoration was not performed`, 409);
        }
      }
      for (const entry of plan.entries) await tx.updateListingMedia(entry.listingId, entry.before);
      tx.batch.status = "restored";
      tx.batch.report = {
        ...tx.batch.report,
        restoredAt: this.now().toISOString(),
        listingCount: plan.entries.length,
        photoCount: plan.entries.reduce((count, entry) => count + entry.fileIds.length, 0),
      };
      await tx.save();
      return tx.batch;
    });
  }
}