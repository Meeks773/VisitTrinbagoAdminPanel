import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { listings, photoImportBatches } from "@shared/schema";
import type {
  MediaSnapshot,
  PhotoImportBatch,
  PhotoImportCatalogItem,
} from "@shared/photo-import-types";

export interface PhotoImportListing extends PhotoImportCatalogItem, MediaSnapshot {}

export interface PhotoImportTransaction {
  batch: PhotoImportBatch;
  lockListings(ids: number[]): Promise<PhotoImportListing[]>;
  updateListingMedia(id: number, media: MediaSnapshot): Promise<void>;
  save(): Promise<void>;
}

export interface PhotoImportRepository {
  createBatch(batch: PhotoImportBatch): Promise<void>;
  listBatches(): Promise<Array<Pick<PhotoImportBatch, "id" | "name" | "status" | "createdAt" | "updatedAt"> & { fileCount: number }>>;
  getBatch(id: string): Promise<PhotoImportBatch | null>;
  getCatalog(): Promise<PhotoImportCatalogItem[]>;
  withBatch<T>(id: string, action: (transaction: PhotoImportTransaction) => Promise<T>): Promise<T>;
}

export class DatabasePhotoImportRepository implements PhotoImportRepository {
  async createBatch(batch: PhotoImportBatch): Promise<void> {
    await db.insert(photoImportBatches).values({
      id: batch.id,
      name: batch.name,
      status: batch.status,
      fileCount: batch.files.length,
      batch,
      createdAt: new Date(batch.createdAt),
      updatedAt: new Date(batch.updatedAt),
    });
  }

  async listBatches() {
    const rows = await db.select({
      id: photoImportBatches.id,
      name: photoImportBatches.name,
      status: photoImportBatches.status,
      fileCount: photoImportBatches.fileCount,
      createdAt: photoImportBatches.createdAt,
      updatedAt: photoImportBatches.updatedAt,
    }).from(photoImportBatches).orderBy(asc(photoImportBatches.createdAt));
    return rows.map((row) => ({
      ...row,
      status: row.status as PhotoImportBatch["status"],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async getBatch(id: string): Promise<PhotoImportBatch | null> {
    const [row] = await db.select({ batch: photoImportBatches.batch })
      .from(photoImportBatches).where(eq(photoImportBatches.id, id)).limit(1);
    return row?.batch ?? null;
  }

  async getCatalog(): Promise<PhotoImportCatalogItem[]> {
    return db.select({
      id: listings.id,
      name: listings.name,
      category: listings.category,
      location: listings.location,
      status: listings.status,
    }).from(listings).orderBy(asc(listings.id));
  }

  async withBatch<T>(id: string, action: (transaction: PhotoImportTransaction) => Promise<T>): Promise<T> {
    return db.transaction(async (transaction) => {
      const [row] = await transaction.select().from(photoImportBatches)
        .where(eq(photoImportBatches.id, id)).for("update").limit(1);
      if (!row) throw new PhotoImportError("Photo import batch not found", 404);
      const batch = structuredClone(row.batch);
      let dirty = false;
      const tx: PhotoImportTransaction = {
        batch,
        async lockListings(ids) {
          if (!ids.length) return [];
          const rows = await transaction.select({
            id: listings.id,
            name: listings.name,
            category: listings.category,
            location: listings.location,
            status: listings.status,
            featuredImage: listings.featuredImage,
            galleryImages: listings.galleryImages,
            photoMedia: listings.photoMedia,
          }).from(listings).where(inArray(listings.id, [...new Set(ids)])).orderBy(asc(listings.id)).for("update");
          return rows;
        },
        async updateListingMedia(listingId, media) {
          const changed = await transaction.update(listings).set({
            featuredImage: media.featuredImage,
            galleryImages: media.galleryImages,
            photoMedia: media.photoMedia,
          }).where(and(eq(listings.id, listingId))).returning({ id: listings.id });
          if (!changed.length) throw new PhotoImportError(`Listing ${listingId} no longer exists`, 409);
        },
        async save() {
          dirty = true;
        },
      };
      const result = await action(tx);
      if (dirty) {
        batch.updatedAt = new Date().toISOString();
        await transaction.update(photoImportBatches).set({
          name: batch.name,
          status: batch.status,
          fileCount: batch.files.length,
          batch,
          updatedAt: new Date(batch.updatedAt),
        }).where(eq(photoImportBatches.id, id));
      }
      return result;
    });
  }
}

export class PhotoImportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PhotoImportError";
  }
}