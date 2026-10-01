import test, { after, before, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import express, { type Response as ExpressResponse } from "express";
import session from "express-session";
import type { File } from "@google-cloud/storage";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { setupAuth } from "../server/auth";

// Never read or preserve inherited credentials. Set these before importing the
// routes/db modules; even an accidental DB connection cannot reach real data.
const TEST_EMAIL = "media-security-admin@example.invalid";
const TEST_PASSWORD = "synthetic-media-password-123456";
const TEST_SECRET = "synthetic-media-session-secret-at-least-32-characters";
function setTestEnvironment() {
  process.env.ADMIN_EMAIL = TEST_EMAIL;
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://media-test:synthetic-db-password@127.0.0.1:1/media_security_test";
  process.env.PRIVATE_OBJECT_DIR = "/synthetic-media-bucket/private";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/synthetic-media-bucket/public";
}
setTestEnvironment();

const { registerObjectStorageRoutes } = await import("../server/replit_integrations/object_storage/routes");
const { ObjectStorageService, ObjectNotFoundError, objectStorageClient } =
  await import("../server/replit_integrations/object_storage/objectStorage");
const {
  mediaKind, mayReadMedia, DISPLAY_CONTENT_TYPES, ORIGINAL_CONTENT_TYPES,
  MAX_DISPLAY_BYTES, MAX_ORIGINAL_BYTES,
} = await import("../server/replit_integrations/object_storage/mediaPolicy");
const { isPublicMediaReference } = await import("../server/media-access");
const { db } = await import("../server/db");
const { listings, events } = await import("../shared/schema");
type MediaPurpose = "display" | "original";

// Only fixture requests use the captured transport, against their ephemeral
// loopback server. All other HTTP/cloud/DB activity must be explicitly mocked.
const fixtureFetch = globalThis.fetch.bind(globalThis);
before(() => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("Unmocked network access is forbidden in media security tests");
  });
  mock.method(objectStorageClient, "bucket", () => {
    throw new Error("Real cloud access is forbidden in media security tests");
  });
  mock.method(db, "select", () => {
    throw new Error("Real database access is forbidden in media security tests");
  });
});
after(() => mock.restoreAll());

const IMAGE_BYTES = Buffer.from("synthetic-raster-fixture");
type FakeMetadata = {
  contentType?: string;
  size?: string | number;
  metadata?: Record<string, string>;
};
function fakeFile(metadata: FakeMetadata = {}) {
  const state = { metadataReads: 0, streamReads: 0, existsReads: 0 };
  const file = {
    name: "synthetic-object",
    async exists() {
      state.existsReads++;
      return [true];
    },
    async getMetadata() {
      state.metadataReads++;
      return [{
        contentType: "image/jpeg",
        size: String(IMAGE_BYTES.length),
        metadata: {
          "custom:aclPolicy": JSON.stringify({ owner: "synthetic-owner", visibility: "public" }),
        },
        ...metadata,
      }];
    },
    createReadStream() {
      state.streamReads++;
      return Readable.from([IMAGE_BYTES]);
    },
  } as unknown as File;
  return { file, state };
}

class RecordingStorage extends ObjectStorageService {
  uploadCalls: MediaPurpose[] = [];
  fileCalls: string[] = [];
  downloads: { file: File; attachment: boolean }[] = [];
  readonly fixtureFile;

  constructor(metadata: FakeMetadata = {}) {
    super();
    this.fixtureFile = fakeFile(metadata);
  }

  override async getObjectEntityUploadURL(purpose: MediaPurpose = "display") {
    this.uploadCalls.push(purpose);
    const namespace = purpose === "original" ? "originals" : "display";
    return `https://storage.googleapis.com/synthetic-media-bucket/private/${namespace}/synthetic-id?synthetic-signature=test-only`;
  }

  override async getObjectEntityFile(path: string) {
    this.fileCalls.push(path);
    return this.fixtureFile.file;
  }

  override async downloadObject(file: File, res: ExpressResponse, options: { attachment?: boolean } = {}) {
    this.downloads.push({ file, attachment: options.attachment === true });
    // Exercise the real serving policy with synthetic metadata and bytes.
    return super.downloadObject(file, res, options);
  }
}

type RawResponse = { status: number; headers: Headers; body: string };
type Fixture = {
  base: string;
  storage: RecordingStorage;
  publicCalls: string[];
  request: (path: string, options?: RequestInit) => Promise<globalThis.Response>;
  rawRequest: (path: string, cookie?: string) => Promise<RawResponse>;
  login: () => Promise<string>;
  upload: (body: unknown, cookie?: string, headers?: Record<string, string>) => Promise<globalThis.Response>;
};

async function withFixture(
  run: (fixture: Fixture) => Promise<void>,
  options: {
    storage?: RecordingStorage;
    isPublicReference?: (path: string) => Promise<boolean>;
  } = {},
) {
  setTestEnvironment();
  const store = new session.MemoryStore();
  const storage = options.storage ?? new RecordingStorage();
  const publicCalls: string[] = [];
  const app = express();
  app.use(express.json({ strict: false }));
  setupAuth(app, { store });
  registerObjectStorageRoutes(app, {
    storage,
    isPublicReference: async (path) => {
      publicCalls.push(path);
      return options.isPublicReference ? options.isPublicReference(path) : false;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const request: Fixture["request"] = (path, init) => fixtureFetch(`${base}${path}`, init);
  const upload: Fixture["upload"] = (body, cookie, headers = {}) => request("/api/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
  const login = async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie, "Synthetic login must issue a session cookie");
    await response.arrayBuffer();
    return cookie.split(";")[0];
  };
  // fetch normalizes dot segments. Use raw HTTP to ensure the server itself
  // rejects traversal, rather than relying on the test client's URL parser.
  const rawRequest: Fixture["rawRequest"] = (path, cookie) => new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port, method: "GET", path,
      headers: cookie ? { Cookie: cookie } : {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve({ status: res.statusCode!, headers, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on("error", reject);
    req.end();
  });
  try {
    await run({ base, storage, publicCalls, request, rawRequest, login, upload });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    store.clear();
    setTestEnvironment();
  }
}

function assertPrivateMediaHeaders(response: { headers: Headers }) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("vary") ?? "", /(?:^|,\s*)Cookie(?:,|$)/i);
  assert.doesNotMatch(response.headers.get("cache-control")!, /(?:^|[,\s])public(?:$|[,\s])|s-maxage/i);
}

const VALID_UPLOAD = { name: "photo.jpg", size: 1024, contentType: "image/jpeg" };
const BAD_PATHS = [
  "/objects/display/../originals/private",
  "/objects/display/./public",
  "/objects/display/%2e%2e",
  "/objects/display/%252e%252e",
  "/objects/display/%70ublic",
  "/objects/display/public%2Fprivate",
  "/objects/display/public%252Fprivate",
  "/objects/display/public%5Cprivate",
  "/objects//display/public",
  "/objects/display//public",
  "/objects/display/public/private",
  "/objects/display/public/",
  "/objects/unknown/public",
  "/objects/original/public",
  "/objects/display/.hidden",
  "/objects/display/-leading",
  "/objects/display/public..jpg",
  "/objects/display/" + "a".repeat(201),
];

test("anonymous uploads return 401 without invoking a signer", async () => {
  await withFixture(async ({ storage, upload }) => {
    for (const body of [VALID_UPLOAD, null, { ...VALID_UPLOAD, purpose: "original" }]) {
      const response = await upload(body);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { message: "Not authenticated" });
    }
    assert.deepEqual(storage.uploadCalls, []);
    assert.deepEqual(storage.fileCalls, []);
  });
});

test("synthetic admin login issues signed uploads in the correct namespaces without caching", async (context) => {
  const storage = new RecordingStorage();
  const signedRequests: { bucket_name: string; object_name: string; method: string; expires_at: string }[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "http://127.0.0.1:1106/object-storage/signed-object-url");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    signedRequests.push(body);
    return new globalThis.Response(JSON.stringify({
      signed_url: `https://storage.googleapis.com/${body.bucket_name}/${body.object_name}?synthetic-signature=test-only`,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  context.mock.method(storage, "getObjectEntityUploadURL", async (purpose: MediaPurpose = "display") => {
    storage.uploadCalls.push(purpose);
    return ObjectStorageService.prototype.getObjectEntityUploadURL.call(storage, purpose);
  });
  await withFixture(async ({ upload, login }) => {
    const cookie = await login();
    for (const purpose of [undefined, "display", "original"] as const) {
      const started = Date.now();
      const response = await upload({ ...VALID_UPLOAD, name: " photo.jpg ", ...(purpose ? { purpose } : {}) }, cookie);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      const expectedPurpose = purpose ?? "display";
      const namespace = expectedPurpose === "original" ? "originals" : "display";
      assert.match(body.objectPath, new RegExp(`^/objects/${namespace}/[a-f0-9-]{36}$`));
      assert.match(body.uploadURL, new RegExp(`/private/${namespace}/[a-f0-9-]{36}\\?synthetic-signature=test-only$`));
      assert.deepEqual(body.metadata, { ...VALID_UPLOAD, purpose: expectedPurpose });
      const signed = signedRequests.at(-1)!;
      assert.equal(signed.bucket_name, "synthetic-media-bucket");
      assert.equal(signed.object_name, `private/${namespace}/${body.objectPath.split("/").at(-1)}`);
      assert.equal(signed.method, "PUT");
      const expires = Date.parse(signed.expires_at);
      assert.ok(expires >= started + 900_000 && expires <= Date.now() + 900_000);
    }
    assert.deepEqual(storage.uploadCalls, ["display", "display", "original"]);
    assert.equal(signedRequests.length, 3);
  }, { storage });
});

test("invalid upload names, sizes, types and purposes are rejected before signing", async () => {
  const invalidBodies = [
    null, [], {}, { ...VALID_UPLOAD, name: undefined }, { ...VALID_UPLOAD, name: 123 },
    { ...VALID_UPLOAD, name: "" }, { ...VALID_UPLOAD, name: " \t " }, { ...VALID_UPLOAD, name: "a".repeat(256) },
    { ...VALID_UPLOAD, size: undefined }, { ...VALID_UPLOAD, size: "1024" },
    { ...VALID_UPLOAD, size: 0 }, { ...VALID_UPLOAD, size: -1 }, { ...VALID_UPLOAD, size: 1.5 },
    { ...VALID_UPLOAD, size: null }, { ...VALID_UPLOAD, size: MAX_DISPLAY_BYTES + 1 },
    { ...VALID_UPLOAD, contentType: undefined }, { ...VALID_UPLOAD, contentType: 123 },
    { ...VALID_UPLOAD, contentType: "text/html" }, { ...VALID_UPLOAD, contentType: "image/svg+xml" },
    { ...VALID_UPLOAD, contentType: "application/octet-stream" },
    { ...VALID_UPLOAD, contentType: "image/tiff" }, { ...VALID_UPLOAD, contentType: "image/heic" },
    { ...VALID_UPLOAD, purpose: null }, { ...VALID_UPLOAD, purpose: "originals" },
    { ...VALID_UPLOAD, purpose: "public" }, { ...VALID_UPLOAD, purpose: 123 },
    { ...VALID_UPLOAD, purpose: "original", contentType: "text/html" },
    { ...VALID_UPLOAD, purpose: "original", contentType: "image/svg+xml" },
    { ...VALID_UPLOAD, purpose: "original", size: MAX_ORIGINAL_BYTES + 1 },
  ];
  await withFixture(async ({ login, upload, storage }) => {
    const cookie = await login();
    for (const body of invalidBodies) {
      const response = await upload(body, cookie);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: "Provide a valid image name, size, contentType and purpose (display or original)",
      });
    }
    assert.deepEqual(storage.uploadCalls, []);
  });
});

test("allowed upload types and exact size limits remain accepted for each purpose", async () => {
  await withFixture(async ({ login, upload, storage }) => {
    const cookie = await login();
    for (const purpose of ["display", "original"] as const) {
      const types = purpose === "display" ? DISPLAY_CONTENT_TYPES : ORIGINAL_CONTENT_TYPES;
      const size = purpose === "display" ? MAX_DISPLAY_BYTES : MAX_ORIGINAL_BYTES;
      for (const contentType of types) {
        const response = await upload({ name: "a".repeat(255), size, contentType, purpose }, cookie);
        assert.equal(response.status, 200, `${purpose}: ${contentType}`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        await response.arrayBuffer();
      }
    }
    assert.equal(storage.uploadCalls.length, DISPLAY_CONTENT_TYPES.length + ORIGINAL_CONTENT_TYPES.length);
  });
});

test("signing failures return a non-cacheable generic error without exposing signed URLs or private details", async (context) => {
  const storage = new RecordingStorage();
  context.mock.method(storage, "getObjectEntityUploadURL", async () => {
    throw new Error("synthetic-private-signer-detail?synthetic-signature=must-not-leak");
  });
  await withFixture(async ({ login, upload }) => {
    const response = await upload(VALID_UPLOAD, await login());
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Failed to generate upload URL" });
    assert.deepEqual(storage.fileCalls, []);
  }, { storage });
});

test("cross-origin upload writes return 403 without signing, even for an authenticated admin", async () => {
  await withFixture(async ({ login, upload, storage, base }) => {
    const cookie = await login();
    for (const headers of [
      { Origin: "https://cross-origin.example.invalid" },
      { Origin: "null" },
      { Origin: base, "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { Referer: "https://cross-origin.example.invalid/admin" },
    ] as Record<string, string>[]) {
      for (const credentials of [undefined, cookie]) {
        const response = await upload(VALID_UPLOAD, credentials, headers);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { message: "Cross-origin requests are not allowed" });
      }
    }
    assert.deepEqual(storage.uploadCalls, []);
    const response = await upload(VALID_UPLOAD, cookie, { Origin: base, "Sec-Fetch-Site": "same-origin" });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.deepEqual(storage.uploadCalls, ["display"]);
  });
});

test("anonymous unused and draft-only media return 404 without any storage read", async () => {
  await withFixture(async ({ request, storage, publicCalls }) => {
    for (const path of ["/objects/display/unused", "/objects/display/draft-only", "/objects/uploads/draft-legacy"]) {
      const response = await request(path);
      assert.equal(response.status, 404);
      assertPrivateMediaHeaders(response);
      assert.deepEqual(await response.json(), { error: "Object not found" });
    }
    assert.equal(publicCalls.length, 3);
    assert.deepEqual(storage.fileCalls, []);
    assert.deepEqual(storage.downloads, []);
    assert.equal(storage.fixtureFile.state.metadataReads, 0);
  });
});

test("anonymous publicly referenced display and legacy uploads are readable but never shared-cacheable", async () => {
  const publicPaths = new Set(["/objects/display/published.jpg", "/objects/uploads/legacy-image"]);
  await withFixture(async ({ request, storage, publicCalls }) => {
    for (const path of publicPaths) {
      const response = await request(path);
      assert.equal(response.status, 200);
      assertPrivateMediaHeaders(response);
      assert.equal(response.headers.get("content-disposition"), "inline");
      assert.equal(response.headers.get("content-type"), "image/jpeg");
      assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), IMAGE_BYTES);
    }
    assert.deepEqual(publicCalls, [...publicPaths]);
    assert.deepEqual(storage.fileCalls, [...publicPaths]);
    assert.equal(storage.downloads.every((download) => !download.attachment), true);
  }, { isPublicReference: async (path) => publicPaths.has(path) });
});

test("removing a public reference immediately revokes anonymous GET and HEAD access", async () => {
  let published = true;
  await withFixture(async ({ request, storage, publicCalls }) => {
    const path = "/objects/display/removed-from-catalogue";
    const before = await request(path);
    assert.equal(before.status, 200);
    assertPrivateMediaHeaders(before);
    await before.arrayBuffer();
    published = false;
    for (const method of ["GET", "HEAD"]) {
      const response = await request(path, { method });
      assert.equal(response.status, 404);
      assertPrivateMediaHeaders(response);
      await response.arrayBuffer();
    }
    assert.deepEqual(publicCalls, [path, path, path]);
    assert.deepEqual(storage.fileCalls, [path]);
    assert.equal(storage.downloads.length, 1);
  }, { isPublicReference: async () => published });
});

test("anonymous originals are denied even with an always-public predicate and custom public ACL metadata", async () => {
  const storage = new RecordingStorage();
  // Prove the synthetic file has the legacy public ACL before testing the route.
  const [metadata] = await storage.fixtureFile.file.getMetadata();
  assert.equal(JSON.parse(String(metadata.metadata!["custom:aclPolicy"])).visibility, "public");
  const initialMetadataReads = storage.fixtureFile.state.metadataReads;
  await withFixture(async ({ request, publicCalls }) => {
    for (const method of ["GET", "HEAD"]) {
      const response = await request("/objects/originals/private-original", { method });
      assert.equal(response.status, 404);
      assertPrivateMediaHeaders(response);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.deepEqual(await response.json(), { error: "Object not found" });
    }
    assert.deepEqual(publicCalls, []);
    assert.deepEqual(storage.fileCalls, []);
    assert.deepEqual(storage.downloads, []);
    assert.equal(storage.fixtureFile.state.metadataReads, initialMetadataReads);
  }, { storage, isPublicReference: async () => true });
});

test("authenticated originals use attachment options, restrictive CSP, nosniff and no-store", async () => {
  await withFixture(async ({ login, request, storage, publicCalls }) => {
    const cookie = await login();
    const response = await request("/objects/originals/admin-original", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assertPrivateMediaHeaders(response);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="original-image"');
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), IMAGE_BYTES);
    assert.deepEqual(publicCalls, []);
    assert.deepEqual(storage.fileCalls, ["/objects/originals/admin-original"]);
    assert.equal(storage.downloads[0].attachment, true);
  }, { storage: new RecordingStorage({ contentType: "image/tiff" }) });
});

test("admin previews of unreferenced display and legacy media bypass public-reference checks, not cache policy", async () => {
  await withFixture(async ({ login, request, storage, publicCalls }) => {
    const cookie = await login();
    for (const path of ["/objects/display/draft-preview", "/objects/uploads/unused-legacy"]) {
      const response = await request(path, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assertPrivateMediaHeaders(response);
      assert.equal(response.headers.get("content-disposition"), "inline");
      await response.arrayBuffer();
    }
    assert.deepEqual(publicCalls, []);
    assert.equal(storage.fileCalls.length, 2);
  });
});

test("missing authorized objects return a generic private no-store 404 for GET and HEAD", async (context) => {
  const storage = new RecordingStorage();
  context.mock.method(storage, "getObjectEntityFile", async (path: string) => {
    storage.fileCalls.push(path);
    throw new ObjectNotFoundError();
  });
  await withFixture(async ({ request }) => {
    for (const method of ["GET", "HEAD"]) {
      const response = await request("/objects/display/missing", { method });
      assert.equal(response.status, 404);
      assertPrivateMediaHeaders(response);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.deepEqual(await response.json(), { error: "Object not found" });
    }
    assert.equal(storage.fileCalls.length, 2);
    assert.deepEqual(storage.downloads, []);
  }, { storage, isPublicReference: async () => true });
});

test("traversal, encoding, double separators and unknown namespaces are refused for anonymous and admin reads", async () => {
  await withFixture(async ({ rawRequest, login, storage, publicCalls }) => {
    const cookie = await login();
    for (const path of BAD_PATHS) {
      assert.equal(mediaKind(path), null, path);
      assert.equal(mayReadMedia(path, true, true), false, path);
      for (const credentials of [undefined, cookie]) {
        const response = await rawRequest(path, credentials);
        assert.equal(response.status, 404, path);
        assertPrivateMediaHeaders(response);
        assert.deepEqual(JSON.parse(response.body), { error: "Object not found" });
      }
    }
    assert.deepEqual(publicCalls, []);
    assert.deepEqual(storage.fileCalls, []);
  }, { isPublicReference: async () => true });
});

test("HEAD shares public-reference, original authorization and serving-header checks", async () => {
  await withFixture(async ({ login, request, storage, publicCalls }) => {
    const cases = [
      { path: "/objects/display/public", status: 200 },
      { path: "/objects/uploads/public-legacy", status: 200 },
      { path: "/objects/display/draft", status: 404 },
      { path: "/objects/originals/private", status: 404 },
      { path: "/objects/unknown/public", status: 404 },
    ];
    for (const { path, status } of cases) {
      const response = await request(path, { method: "HEAD" });
      assert.equal(response.status, status, path);
      assertPrivateMediaHeaders(response);
      assert.equal(await response.text(), "");
    }
    assert.deepEqual(storage.fileCalls, ["/objects/display/public", "/objects/uploads/public-legacy"]);
    assert.deepEqual(publicCalls, ["/objects/display/public", "/objects/uploads/public-legacy", "/objects/display/draft"]);
    const cookie = await login();
    const response = await request("/objects/originals/private", { method: "HEAD", headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assertPrivateMediaHeaders(response);
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="original-image"');
    assert.equal(await response.text(), "");
    assert.equal(storage.downloads.at(-1)!.attachment, true);
  }, { isPublicReference: async (path) => path.includes("public") });
});

test("media policy never treats originals as public and only recognizes bounded media keys", () => {
  for (const [namespace, kind] of [["display", "display"], ["uploads", "legacy"], ["originals", "original"]] as const) {
    const path = `/objects/${namespace}/synthetic_ID-123.jpg`;
    assert.equal(mediaKind(path), kind);
    assert.equal(mayReadMedia(path, false, false), false);
    assert.equal(mayReadMedia(path, false, true), kind !== "original");
    assert.equal(mayReadMedia(path, true, false), true);
  }
  assert.equal(mediaKind("/objects/display/" + "a".repeat(200)), "display");
  for (const path of BAD_PATHS) assert.equal(mediaKind(path), null, path);
});

test("real downloadObject rejects HTML/SVG/non-raster inline content before streaming, including HEAD", async () => {
  for (const contentType of ["text/html", "image/svg+xml", "application/octet-stream", "image/tiff"]) {
    const storage = new RecordingStorage({ contentType });
    await withFixture(async ({ request }) => {
      for (const method of ["GET", "HEAD"]) {
        const response = await request("/objects/display/referenced", { method });
        assert.equal(response.status, 415, contentType);
        assertPrivateMediaHeaders(response);
        if (method === "HEAD") assert.equal(await response.text(), "");
        else assert.deepEqual(await response.json(), { error: "Only raster display images can be served inline" });
      }
      assert.equal(storage.fixtureFile.state.streamReads, 0);
    }, { storage, isPublicReference: async () => true });
  }
});

test("real downloadObject refuses oversized, missing and malformed metadata without streaming", async () => {
  for (const size of [MAX_DISPLAY_BYTES + 1, "not-a-number", 0, -1, 1.5, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const storage = new RecordingStorage({ size });
    await withFixture(async ({ request }) => {
      const response = await request("/objects/display/referenced");
      assert.equal(response.status, 413, `metadata size ${size}`);
      assertPrivateMediaHeaders(response);
      assert.deepEqual(await response.json(), { error: "Image exceeds the serving size limit" });
      assert.equal(storage.fixtureFile.state.streamReads, 0);
    }, { storage, isPublicReference: async () => true });
  }
  const storage = new RecordingStorage({ size: MAX_ORIGINAL_BYTES + 1 });
  await withFixture(async ({ login, request }) => {
    const response = await request("/objects/originals/too-large", { headers: { Cookie: await login() } });
    assert.equal(response.status, 413);
    assertPrivateMediaHeaders(response);
    await response.arrayBuffer();
    assert.equal(storage.fixtureFile.state.streamReads, 0);
  }, { storage });
});

test("real downloadObject normalizes raster MIME parameters and forces dangerous original content to attachments", async () => {
  await withFixture(async ({ request }) => {
    const response = await request("/objects/display/referenced");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assertPrivateMediaHeaders(response);
    await response.arrayBuffer();
  }, { storage: new RecordingStorage({ contentType: " IMAGE/JPEG ; charset=binary" }), isPublicReference: async () => true });
  for (const contentType of ["text/html", "image/svg+xml"]) {
    await withFixture(async ({ login, request }) => {
      const response = await request("/objects/originals/unsafe-inline", { headers: { Cookie: await login() } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/octet-stream");
      assert.equal(response.headers.get("content-disposition"), 'attachment; filename="original-image"');
      assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
      assertPrivateMediaHeaders(response);
      await response.arrayBuffer();
    }, { storage: new RecordingStorage({ contentType }) });
  }
});

test("object file resolution rejects unsafe paths before cloud access and maps valid namespaces to the private prefix", async (context) => {
  const service = new ObjectStorageService();
  const buckets: string[] = [];
  const keys: string[] = [];
  const synthetic = fakeFile();
  context.mock.method(objectStorageClient, "bucket", (name: string) => {
    buckets.push(name);
    return {
      file(key: string) {
        keys.push(key);
        return synthetic.file;
      },
    } as ReturnType<typeof objectStorageClient.bucket>;
  });
  for (const path of BAD_PATHS) await assert.rejects(service.getObjectEntityFile(path), ObjectNotFoundError);
  assert.deepEqual(buckets, []);
  for (const namespace of ["display", "uploads", "originals"]) {
    assert.equal(await service.getObjectEntityFile(`/objects/${namespace}/synthetic-id`), synthetic.file);
  }
  assert.deepEqual(buckets, Array(3).fill("synthetic-media-bucket"));
  assert.deepEqual(keys, ["private/display/synthetic-id", "private/uploads/synthetic-id", "private/originals/synthetic-id"]);
  assert.equal(synthetic.state.existsReads, 3);
  assert.equal(synthetic.state.metadataReads, 0);
  assert.equal(synthetic.state.streamReads, 0);
  const nonexistent = { async exists() { return [false]; } } as unknown as File;
  context.mock.method(objectStorageClient, "bucket", () => ({
    file: () => nonexistent,
  }) as unknown as ReturnType<typeof objectStorageClient.bucket>);
  await assert.rejects(service.getObjectEntityFile("/objects/display/missing"), ObjectNotFoundError);
});

type QueryCapture = { selection: unknown; table: unknown; condition: SQL; limit: number };
function mockReferenceQueries(context: TestContext, results: { id: number }[][]) {
  const captured: QueryCapture[] = [];
  context.mock.method(db, "select", ((selection: unknown) => ({
    from(table: unknown) {
      return {
        where(condition: SQL) {
          return {
            async limit(limit: number) {
              captured.push({ selection, table, condition, limit });
              assert.ok(results.length > 0, "Unexpected database query");
              return results.shift()!;
            },
          };
        },
      };
    },
  })) as unknown as typeof db.select);
  return captured;
}

function assertReferenceQuery(query: QueryCapture, path: string, table: typeof listings | typeof events) {
  assert.equal(query.table, table);
  assert.deepEqual(query.selection, { id: table.id });
  assert.equal(query.limit, 1);
  const compiled = new PgDialect().sqlToQuery(query.condition);
  const text = compiled.sql.replace(/\s+/g, " ");
  if (table === listings) {
    // Verify the grouped OR cannot admit a gallery image from a draft listing.
    assert.equal(text, '("listings"."status" = $1 and ("listings"."featured_image" = $2 or $3 = ANY("listings"."gallery_images")))');
    assert.deepEqual(compiled.params, ["published", path, path]);
  } else {
    assert.equal(text, '("events"."featured_image" = $1 or $2 = ANY("events"."gallery_images"))');
    assert.deepEqual(compiled.params, [path, path]);
  }
}

test("public-reference query contract requires published listings and featured/gallery references", async (context) => {
  const path = "/objects/display/published-only";
  const queries = mockReferenceQueries(context, [[{ id: 101 }]]);
  assert.equal(await isPublicMediaReference(path), true);
  assert.equal(queries.length, 1, "Published listing hit should short-circuit event lookup");
  assertReferenceQuery(queries[0], path, listings);
});

test("public-reference query contract falls back to currently public events, including legacy uploads", async (context) => {
  const path = "/objects/uploads/event-legacy";
  const queries = mockReferenceQueries(context, [[], [{ id: 202 }]]);
  assert.equal(await isPublicMediaReference(path), true);
  assert.equal(queries.length, 2);
  assertReferenceQuery(queries[0], path, listings);
  assertReferenceQuery(queries[1], path, events);
});

test("no published-listing/event match returns false without any data mutations", async (context) => {
  const path = "/objects/display/draft-or-unused";
  const queries = mockReferenceQueries(context, [[], []]);
  assert.equal(await isPublicMediaReference(path), false);
  assert.equal(queries.length, 2);
  assertReferenceQuery(queries[0], path, listings);
  assertReferenceQuery(queries[1], path, events);
});

test("public-reference service rejects originals and invalid keys without a DB lookup", async (context) => {
  const queries = mockReferenceQueries(context, []);
  for (const path of ["/objects/originals/public-acl", ...BAD_PATHS]) {
    assert.equal(await isPublicMediaReference(path), false, path);
  }
  assert.deepEqual(queries, []);
});

test("reference lookup errors fail closed at the HTTP boundary without leaking details or reading storage", async (context) => {
  const privateError = new Error("synthetic-private-database-detail");
  context.mock.method(db, "select", () => { throw privateError; });
  await assert.rejects(isPublicMediaReference("/objects/display/referenced"), (error) => error === privateError);
  await withFixture(async ({ request, storage }) => {
    const response = await request("/objects/display/referenced");
    assert.equal(response.status, 500);
    assertPrivateMediaHeaders(response);
    assert.deepEqual(await response.json(), { error: "Failed to serve object" });
    assert.deepEqual(storage.fileCalls, []);
  }, { isPublicReference: isPublicMediaReference });
});