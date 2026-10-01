# Bulk photo import backend

This is an additive backend for the CMS source clone. It is not a migration,
upload, listing change, or publication instruction for the mobile application.
The admin flow stores photo bytes in the CMS's existing private GCS-backed
object storage; PostgreSQL stores only bounded workflow JSON and object
references. Originals and all upload staging objects remain in the private
`originals` namespace.

## Storage and validation

The browser submits one source file at a time (maximum 50 MiB and 40 MP), plus
the two optimized derivatives. The server never accepts image bytes in JSON or
proxies browser uploads. `POST .../upload-urls` issues three 15-minute signed
PUTs whose object paths are random, private originals staging keys. The server
does not issue PUT URLs for final keys.

Finalize reads each staging object with hard byte bounds, re-hashes bytes, and
inspects image signatures and bounded container headers. JPEG, PNG and static
WebP sources are accepted. Animated WebP/APNG, unsupported/corrupt formats,
MIME/hash/size mismatches, derivatives with metadata chunks, excessive
dimensions, and derivatives that upscale the source are rejected. The browser
owns image decode/resize/encoding; the server intentionally does not decode or
re-encode pixels and adds no image runtime dependency.

Only validated bytes are written by the server to create-only, immutable
versioned final keys. A failed finalize records a bounded error on the file and
can be retried after requesting fresh staging URLs. Partial final objects are
private and are never deleted automatically. Signed URLs are returned only to
the authenticated admin response and are never persisted in batch JSON.

`photo_media` contains only validated card/detail public display references,
hashes, dimensions and byte counts. A listing's new `featuredImage` and
`galleryImages` continue to use its detail copy. Public media authorization
accepts import display paths only when they are valid card/detail references in
a published listing's valid `photo_media`; originals and staging objects are
never public. Existing `featuredImage`/`galleryImages` behavior remains for
legacy media. Public projection suppresses malformed historical `photo_media`.

Ordinary listing create/update may preserve existing `photo_media`, but cannot
create or modify it. When a legacy listing editor changes featured/gallery
references, the server prunes importer metadata to photos still referenced by
those effective fields and recomputes the cover hash only when the featured
reference is one of the retained imported variants. Public projection and media
authorization apply the same reconciliation, so stale JSON alone cannot keep
removed derivatives available. Private originals paths, malformed media paths,
and references to another listing's versioned import derivatives are rejected.
The photo importer is the only service allowed to introduce or change photo
metadata.

An ordinary listing `PATCH` that changes featured/gallery/photo-media fields
must include an `expectedMedia` snapshot from the latest authenticated listing
read. The shape is
`{featuredImage:string|null,galleryImages:string[]|null,photoMedia:object|null}`.
The editor sends it alongside, not inside, the listing fields. The server locks
the listing row with `SELECT ... FOR UPDATE`, compares the expected snapshot
with the current effective media, validates references, reconciles metadata and
updates in that same transaction. Missing snapshots for actual photo changes
return `428`; stale snapshots return `409` and require refetch/review. Core-only
patches and photo fields that are unchanged relative to the locked row remain
backward-compatible without a snapshot. Authenticated listing reads expose
reconciled `photoMedia` so the expected value is the effective catalogue.

## Durable browser-side scan reports

The browser must report files it could not process (including corrupt,
unsupported, oversized and animated inputs) to
`POST /api/photo-imports/:id/issues` as bounded
`{issues:[{filename,bytes,code,message}],sourceTotals:{selectedFiles,selectedBytes}}`.
Each call accepts at most 100 issues; a batch keeps at most 2,500. Issues are
merged idempotently by exact filename/code/byte count, with no image bytes or
browser file handles stored. Source totals are optional and bounded. Changes
invalidate an existing review plan; applied or restored batches reject issue
changes.

If any durable local issues exist, `POST .../:id/review` requires
`acknowledgeLocalIssues: true`. Successful review persists
`localIssuesAcknowledged: true`; the batch response exposes issues and selected
source totals for the UI and export manifest. Issues are not silently converted
into excluded files: each registered file still needs an explicit assignment or
exclusion independently.

## Review, apply and restoration

The batch table stores JSONB metadata, references, plans and snapshots only.
Every batch read-modify-write uses a PostgreSQL row lock; apply/restore lock
affected listing rows in stable ID order. The in-memory service/repository
boundary is injectable for tests.

Every registered file must be explicitly assigned or excluded during review.
Only ready files can be assigned, every assigned listing needs one explicit
cover, and sequence/exact-name suggestions do not resolve duplicate or
ambiguous matches automatically. Applying a plan compares all current image
fields to the `before` snapshot and changes only featured/gallery/photo-media
fields. Listing IDs, status, publication state, and core content are not
modified. Existing gallery references and prior cover are retained with exact
reference and validated source-hash deduplication, with the chosen cover first.
Restoration compares current image fields to the stored `after` snapshot and
restores the prior media fields only; it never deletes listings or objects.
Repeated apply with the same review token and repeated restore are idempotent.

## Development schema and publishing

The Drizzle schema in `shared/schema.ts` is the source of truth. The additive SQL
below is a development-only setup step for this feature, using the workspace's
managed **development** database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_photo_import.sql
```

Never run this command against production or the mobile account database, and
never add it to the publishing build or application startup. The SQL adds
nullable `listings.photo_media` and creates `photo_import_batches`, including
the checks/index also declared in Drizzle. It does not update existing listing
content or publish photos.

Replit publishing compares the actual development and production database
schemas, not the SQL files in the repository. Apply and verify the development
schema before publishing; then review and apply the schema changes in the
Publish flow. Do not choose to overwrite production data with development data.
Skipping development setup can cause startup to fail with
`column "photo_media" does not exist`, even though compilation succeeds.

## Verification

With the project's existing dependencies available, run from the project root:

```sh
npx tsx --test server/photo-import/service.test.ts
npx tsc --noEmit
```

Tests use synthetic image/container bytes and in-memory repositories/storage.
They do not connect to the database, call the object-storage sidecar, upload
photos, or mutate live listings. The normal CMS build command remains:

```sh
npm run build
```

The server uses bounded header/container inspection rather than a full raster
decoder. It does not perform malware scanning, decode JPEG/WebP entropy data,
verify PNG chunk CRCs, or compare browser-provided derivative pixels against a
re-encoded source. These are intentionally outside this dependency-free
backend's validation boundary; signed upload declarations are never treated as
proof of image content.