import type { PhotoMedia, PublicPlacePhoto } from "./photo-media";

export interface VariantDeclaration {
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  format: "webp" | "jpeg";
}
export interface PhotoImportFileInput {
  filename: string;
  sha256: string;
  bytes: number;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}
export interface PhotoImportFile extends PhotoImportFileInput {
  id: string;
  status: "pending" | "ready" | "failed";
  error: string | null;
  originalPath: string | null;
  photo: PublicPlacePhoto | null;
  duplicateOf: string | null;
  reservation?: {
    original: string;
    card: string;
    detail: string;
    cardDeclaration: VariantDeclaration;
    detailDeclaration: VariantDeclaration;
  };
}
export interface MediaSnapshot {
  featuredImage: string | null;
  galleryImages: string[] | null;
  photoMedia: PhotoMedia | null;
}
export interface PhotoImportPlanEntry {
  listingId: number;
  listingName: string;
  fileIds: string[];
  coverFileId: string;
  before: MediaSnapshot;
  after: MediaSnapshot;
}
export interface PhotoImportPlan {
  reviewToken: string;
  createdAt: string;
  entries: PhotoImportPlanEntry[];
  excludedFileIds: string[];
}
export interface PhotoImportBatch {
  id: string;
  name: string;
  status: "staging" | "reviewed" | "applied" | "restored";
  createdAt: string;
  updatedAt: string;
  files: PhotoImportFile[];
  plan: PhotoImportPlan | null;
  localIssues?: LocalPhotoImportIssue[];
  localIssuesAcknowledged?: boolean;
  sourceTotals?: { selectedFiles: number; selectedBytes: number };
  report?: { appliedAt?: string; restoredAt?: string; listingCount: number; photoCount: number };
}

export interface LocalPhotoImportIssue {
  filename: string;
  bytes: number;
  code: string;
  message: string;
  /** Server-controlled audit marker, only after the matching file is ready. */
  resolved?: boolean;
}

export interface PhotoImportSourceTotals {
  selectedFiles: number;
  selectedBytes: number;
}
export interface PhotoImportCatalogItem {
  id: number;
  name: string;
  category: string;
  location: string | null;
  status: string;
}
export interface PhotoMatch {
  status: "candidate" | "ambiguous" | "no_match";
  candidateIds: number[];
  sequence: number | null;
}
export interface PhotoImportBatchResponse {
  batch: PhotoImportBatch;
  catalog: PhotoImportCatalogItem[];
  matches: Record<string, PhotoMatch>;
}
export interface ReviewPhotoImportInput {
  assignments: { fileId: string; listingId: number }[];
  covers: { listingId: number; fileId: string }[];
  excludedFileIds: string[];
  acknowledgeLocalIssues?: boolean;
}
export interface UploadSlot { uploadURL: string; objectPath: string }
export type PhotoUploadUrlsResponse =
  | { ready: true; file: PhotoImportFile }
  | { ready: false; original: UploadSlot; card: UploadSlot; detail: UploadSlot };