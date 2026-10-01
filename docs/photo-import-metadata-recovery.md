# Browser display-metadata rejection and recovery

Canvas re-encoding does not guarantee metadata-free output. Browsers can insert
new ICC color profiles or application headers even though source EXIF was not
copied. Public display copies must therefore be sanitized explicitly.

The importer draws into an sRGB canvas, encodes WebP (or JPEG fallback), then
removes display metadata before computing the declared byte count and SHA-256.
The bounded sanitizer strips WebP ICCP/EXIF/XMP chunks and their VP8X flags, or
JPEG APPn/COM segments, without changing image entropy, dimensions, alpha, or
orientation-corrected pixels. Unknown/animated WebP chunks and malformed
containers fail closed. The original File is still hashed/uploaded unchanged.

Server metadata validation remains mandatory. APP0 is accepted only as a
minimal JFIF header without a thumbnail; arbitrary APP0/JFXX data is not a
metadata-free exception.

## Retry an affected batch after updating the CMS

1. Merge the reviewed correction and publish the CMS frontend **and** server.
2. Reload the CMS page to load the new frontend bundle.
3. Open the existing staging batch, reselect the same files/folder, confirm
   rights, and select **Process and upload**.
4. Ready files are skipped; failed files receive fresh private staging URLs and
   newly sanitized display copies. The source filename/hash/bytes must match.
5. Confirm the files become ready, review assignments/covers, and build a fresh
   dry run. Do not exclude valid photos just to bypass the encoding error.

The metadata error is detected before immutable final writes. Historical
metadata errors matching a successfully finalized filename and source byte
count are marked `resolved` server-side, retained in the audit/export, and
removed from unresolved-error UI/review acknowledgement. Late queued reports
receive the same server-controlled resolution. Other errors, changed source
files, unmatched byte counts, exclusions and review gates remain in force.
HTTP 422 validation errors are not retried automatically with identical bytes.

No database migration is needed for this correction: issue resolution is an
optional field inside existing batch JSONB. The correction itself does not
upload photos, change listing media, apply a batch, or publish drafts.

## Verification

```sh
npx tsx --test client/src/lib/__tests__/photo-display-sanitizer.test.ts \
  client/src/lib/__tests__/photo-processing.test.ts \
  client/src/lib/__tests__/photo-import-state.test.ts \
  client/src/lib/__tests__/photo-import-recovery.test.ts \
  server/photo-import/service.test.ts
npm run build
```

All 36 focused tests pass. Tests cover metadata removal/flags, JPEG scan entropy, input immutability,
bounds/corruption/animation, strict server rejection, hashes/sizes, same-batch
failure/retry and durable resolution, late reporting, and forbidden
client-controlled resolution. Real database/storage integration must still be
validated separately in CMS-owned staging.

A Chromium browser fixture also checked all ten approved sample JPEGs, producing
40 card/detail variants across native WebP and forced JPEG fallback. Original
hashes, bounds, declared byte counts/hashes, and strict server acceptance passed.
Injected WebP ICCP/EXIF/XMP and JPEG APP1/APP2/COM metadata were rejected before
cleanup and accepted afterward; decoded pixels matched the pre-injection
encoder bytes. WebKit was not available, so Safari compatibility remains
unverified. No live CMS/storage/database operation was used for these checks.