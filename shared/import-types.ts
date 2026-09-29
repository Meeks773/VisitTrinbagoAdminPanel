import type { Category } from "./schema";

export interface PlaceImportRow {
  key: string;
  sheet: string;
  rowNumber: number;
  verified: boolean;
  warnings: string[];
  rawColumns: Record<string, string>;
  data: {
    category: Category;
    name: string;
    interest: string;
    subInterest: string;
    description: string;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
    website: string | null;
    phone: string | null;
    email: string | null;
    featuredImage: string | null;
    galleryImages: string[];
    rewardPoints: number;
    metadata: Record<string, unknown>;
  };
  existingId?: number;
}

export interface PlaceImportPreview {
  fileName: string;
  rows: PlaceImportRow[];
  sheets: { name: string; category: Category | null; rows: number; reason?: string }[];
  skipped: { sheet: string; rowNumber: number; name: string; reason: string }[];
  notices: string[];
}

export interface ImportBatchSummary {
  id: number;
  fileName: string;
  status: string;
  createdAt: string;
  importedCount: number;
  skippedCount: number;
}

export interface ImportPreviewResponse extends PlaceImportPreview {
  batchId: number;
}

export interface ImportCommitResponse {
  batchId: number;
  importedCount: number;
  skippedCount: number;
  alreadyImported?: boolean;
}