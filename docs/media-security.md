# Admin authentication and media security

This hardening does not upload the photo pilot, change listing images, publish
drafts, or apply any production batch. It is the prerequisite for a later private
staging and reviewed photo-import workflow.

## Admin setup and credential rotation

Configure these through Replit's Secrets interface, never source code or chat:

- `ADMIN_EMAIL`: the owner's admin sign-in email.
- `ADMIN_PASSWORD`: a **new**, unique password with at least 16 non-padding
  characters (maximum 4,096). Do not reuse the previously committed password.
- `SESSION_SECRET`: at least 32 non-padding characters. An existing strong,
  unexposed secret can be retained; rotate it if compromise is suspected.

There are no built-in credentials or known fallback session secret. Missing or
invalid admin credentials make login return `503` without stopping public reads.
Missing/weak `SESSION_SECRET` prevents server startup.

Sessions are regenerated on login and bound to the current credentials. Sessions
created before this hardening and sessions from before credential rotation are
rejected. Cookies are HTTP-only, SameSite=Lax and Secure in production.

Login throttling allows five attempts per IP per 15-minute window. It is
process-local, not a distributed brute-force defense across replicas; `429`
responses include `Retry-After`. Browser writes must be same-origin. Headerless
non-browser clients, such as authenticated cURL requests, remain supported.
The Express deployment assumes one trusted reverse-proxy hop; preserve or
explicitly revisit that boundary when changing hosting.

Removing credentials from current source does not remove previous commits,
forks, or logs. **Rotation is required**, and production remains on its previous
behavior until the owner publishes the changes with the new secrets configured.
No history rewriting or production deployment is performed by this change.

## Media access rules

| Persistent object reference | Admin session | Anonymous access |
|---|---|---|
| `/objects/display/<id>` | Read/preview | Only while referenced by a published place or public event |
| `/objects/uploads/<id>` (legacy) | Read/preview | Same catalogue check; keeps existing published images working |
| `/objects/originals/<id>` | Download as attachment | **Always denied**, even if referenced by a published record |
| Other namespaces or malformed paths | Denied | Denied |

The catalogue is authoritative: custom object ACL metadata cannot expose an
original or an unreferenced upload. Invalid, unavailable and unauthorized
objects return `404` to avoid disclosing private object existence.

Exact relative `featuredImage` and `galleryImages` references are checked.
Existing local references were checked in development and use the legacy
`/objects/uploads/` namespace. Arbitrary external URLs are not made public through
this route. Events currently have no draft state, so event images follow the
existing public-events contract; if event drafts are introduced, their media
predicate must also filter publication status.

Removing an image reference, deleting a record or returning a place to draft
removes anonymous access unless another public record still references the same
image. Original paths remain private regardless. Previously downloaded copies
and caches created before this fix cannot be recalled.

Object responses use `Cache-Control: private, no-store` and `Vary: Cookie` so an
authenticated preview cannot enter a shared cache and publication changes do not
leave a fresh server cache exposing private images. Inline responses are limited
to raster image content types, with `nosniff` and a sandbox Content Security
Policy. Originals are attachment downloads, never inline documents.

## Upload issuance

`POST /api/uploads/request-url` requires a current admin session and same-origin
browser writes. Request:

```json
{
  "name": "museum-card.webp",
  "size": 123456,
  "contentType": "image/webp",
  "purpose": "display"
}
```

- `name`: nonempty, at most 255 characters.
- `size`: positive integer bytes.
- `purpose`: `display` (default, preserving the existing image editor) or
  `original` (private original namespace).
- Display formats: JPEG, PNG, WebP, GIF and AVIF; declared limit 20 MiB.
- Original formats: those above plus TIFF, HEIC and HEIF; declared limit 100 MiB.
- SVG, HTML and arbitrary documents are not supported.

The response contains `uploadURL`, `objectPath` and echoed metadata. PUT bytes to
`uploadURL` with the file's content type. Keep `objectPath` as the persistent
reference, **not** the temporary signed URL.

Signed PUT URLs expire after 15 minutes and are bearer capabilities: keep them
private. They grant upload access, not permission to publish. Anonymous requests
cannot obtain them. Server request logging omits admin response payloads, including
signed upload URLs, auth responses and private import data.

Size/type declarations are checked when issuing a URL; stored object metadata
and size are checked again when serving it. The direct PUT itself is not a
proxy-enforced byte limit or malware/content scan. Do not claim otherwise.

The existing image editor is for **display copies**, not private originals.
For original staging, clients must explicitly request `purpose: "original"`.
No automatic image optimization, full-folder upload interface, card/detail
variant contract or import approval workflow is introduced by these fixes.

## Verification and next stage

Regression suites:

```sh
npx tsx --test script/auth.test.ts script/media-security.test.ts
```

Tests use synthetic credentials and mocked storage with no live upload or
listing mutation. They cover session invalidation, login regeneration, throttling,
browser-origin checks, upload authorization, private originals, public legacy
images, path validation, safe delivery headers and metadata rejection.

After new credentials are securely configured, check the development login and
existing public images before publishing. The later photo pilot still requires
the actual files and manifests, reviewed matches, preserved galleries,
conflict-safe application, resumable progress, restoration, and explicit owner
approval of a live dry run.