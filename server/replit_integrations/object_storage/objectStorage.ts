import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import { DISPLAY_CONTENT_TYPES, MAX_DISPLAY_BYTES, MAX_ORIGINAL_BYTES, mediaKind, type MediaPurpose } from "./mediaPolicy";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  async downloadObject(file: File, res: Response, options: { attachment?: boolean } = {}) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
      const size = Number(metadata.size);
      const maximum = options.attachment ? MAX_ORIGINAL_BYTES : MAX_DISPLAY_BYTES;
      if (!Number.isSafeInteger(size) || size <= 0 || size > maximum) {
        return res.status(413).json({ error: "Image exceeds the serving size limit" });
      }
      if (!options.attachment && !(DISPLAY_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        return res.status(415).json({ error: "Only raster display images can be served inline" });
      }
      // Set appropriate headers
      res.set({
        "Content-Type": options.attachment ? "application/octet-stream" : contentType,
        "Content-Length": metadata.size,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": options.attachment ? 'attachment; filename="original-image"' : "inline",
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", () => {
        console.error("Media stream failed");
        if (!res.headersSent) {
          res.removeHeader("Content-Length");
          res.status(500).json({ error: "Error streaming file" });
        } else res.destroy();
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Media download failed");
      if (!res.headersSent) {
        res.removeHeader("Content-Length");
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(purpose: MediaPurpose = "display"): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const namespace = purpose === "original" ? "originals" : "display";
    const fullPath = `${privateObjectDir}/${namespace}/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!mediaKind(objectPath)) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  /** Signed PUTs only target private originals staging keys, never final paths. */
  async createPhotoImportStagingUpload(
    batchId: string,
    fileId: string,
    slot: "original" | "card" | "detail",
  ): Promise<{ uploadURL: string; objectPath: string }> {
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!uuid.test(batchId) || !uuid.test(fileId)) throw new Error("Invalid photo import identifiers");
    const objectPath = `/objects/originals/photo-import-staging/${batchId}/${fileId}/${slot}-${randomUUID()}`;
    const fullPath = `${this.getPrivateObjectDir()}${objectPath.slice("/objects".length)}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const uploadURL = await signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
    return { uploadURL, objectPath };
  }

  /** Read at most the caller's bound; object metadata is only an early rejection. */
  async readPrivateObject(objectPath: string, maxBytes: number): Promise<Buffer> {
    if (!mediaKind(objectPath) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new ObjectNotFoundError();
    }
    const file = await this.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
      throw new Error("Staged image exceeds its byte limit");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const value of file.createReadStream()) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) throw new Error("Staged image exceeds its byte limit");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, total);
    if (bytes.length !== size) throw new Error("Staged image byte size changed while reading");
    return bytes;
  }

  /** Immutable final objects are server-written with create-only generation preconditions. */
  async putImmutablePhotoObject(objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    const kind = mediaKind(objectPath);
    if (
      !kind ||
      !/^\/objects\/(?:display|originals)\/photo-imports\//.test(objectPath) ||
      bytes.length < 1 ||
      bytes.length > MAX_ORIGINAL_BYTES
    ) {
      throw new Error("Invalid immutable photo destination");
    }
    const privateDir = this.getPrivateObjectDir().replace(/\/+$/, "");
    const relativePath = objectPath.slice("/objects/".length);
    const { bucketName, objectName } = parseObjectPath(`${privateDir}/${relativePath}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    try {
      await file.save(bytes, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          cacheControl: "private, no-store",
          metadata: { photoImportImmutable: "true" },
        },
      });
    } catch (error) {
      const status = (error as { code?: unknown; response?: { status?: unknown } })?.code ??
        (error as { response?: { status?: unknown } })?.response?.status;
      // A previous attempt may have successfully created this deterministic
      // immutable key before failing on a sibling object. The caller reads and
      // hashes the existing bytes immediately after this method returns.
      if (status === 412 || status === "412") return;
      throw error;
    }
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

