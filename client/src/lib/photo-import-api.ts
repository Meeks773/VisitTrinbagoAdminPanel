import type {
  PhotoImportBatch, PhotoImportBatchResponse, PhotoImportFileInput, PhotoUploadUrlsResponse,
  ReviewPhotoImportInput, VariantDeclaration,
} from "@shared/photo-import-types";

export interface PhotoImportSummary { id: string; name: string; status: PhotoImportBatch["status"]; createdAt: string; updatedAt: string; fileCount: number }

export interface LocalIssueRecord { filename: string; bytes: number; code: string; message: string }
export interface SourceTotals { selectedFiles: number; selectedBytes: number }

export class PhotoImportApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || `Request failed (${res.status})`;
    try { const j = JSON.parse(text); msg = j.message || j.error || msg; } catch { /* plain text */ }
    throw new PhotoImportApiError(res.status, msg);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const base = "/api/photo-imports";
const enc = encodeURIComponent;
export const photoImportApi = {
  list: () => call<{ batches: PhotoImportSummary[] }>("GET", base),
  create: (name: string) => call<{ batch: PhotoImportBatch }>("POST", base, { name }),
  get: (id: string) => call<PhotoImportBatchResponse>("GET", `${base}/${enc(id)}`),
  addFiles: (id: string, files: PhotoImportFileInput[]) => call<{ batch: PhotoImportBatch }>("POST", `${base}/${enc(id)}/files`, { files }),
  uploadUrls: (id: string, fileId: string, card: VariantDeclaration, detail: VariantDeclaration) =>
    call<PhotoUploadUrlsResponse>("POST", `${base}/${enc(id)}/files/${enc(fileId)}/upload-urls`, { card, detail }),
  finalize: (id: string, fileId: string) => call<{ batch: PhotoImportBatch }>("POST", `${base}/${enc(id)}/files/${enc(fileId)}/finalize`, {}),
  reportIssues: (id: string, issues: LocalIssueRecord[], sourceTotals?: SourceTotals) =>
    call<{ batch: PhotoImportBatch }>("POST", `${base}/${enc(id)}/issues`, { issues, sourceTotals }),
  review: (id: string, input: ReviewPhotoImportInput & { acknowledgeLocalIssues?: boolean }) => call<{ batch: PhotoImportBatch }>("POST", `${base}/${enc(id)}/review`, input),
  apply: (id: string, reviewToken: string) =>
    call<{ batch: PhotoImportBatch }>("POST", `${base}/${enc(id)}/apply`, { reviewToken, confirmation: "APPLY REVIEWED PHOTO IMPORT" }),
  restore: (id: string) => call<{ batch: PhotoImportBatch }>("POST", `${base}/${enc(id)}/restore`, { confirmation: "RESTORE PHOTO IMPORT" }),
};
