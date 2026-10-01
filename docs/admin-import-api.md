# VisitTrinbago Admin Import API

Machine-readable specification: [admin-import.openapi.json](admin-import.openapi.json) (OpenAPI 3.0.3).

This API imports place listings from an Excel workbook into **hidden drafts**. It does not publish them, overwrite existing listings, import events, or create offers.

## Base URL and authentication

Use the host of the environment you intend to change. The examples use a placeholder, not a real production address:

```sh
BASE_URL="https://your-admin-host.example"
```

Development and production have separate databases. Loading a workbook into development does not load it into production.

All `/api/imports` endpoints require an admin session. Log in through `POST /api/auth/login` with JSON `{ "email": "...", "password": "..." }`. A successful login returns `{ "user": { "email": "..." } }` and sets the HTTP-only `connect.sid` cookie. Reuse that cookie on subsequent requests. API keys and Bearer tokens are not supported.

The existing custom single-admin authentication reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment. The email must be valid and the password must have at least 16 non-padding characters (maximum 4096). `SESSION_SECRET` must have at least 32 non-padding characters; retain the shared existing secret if valid. There are no hardcoded credentials or fallback secret. Missing or invalid admin configuration returns `503` on login while public reads remain available; a missing or invalid session secret fails server startup.

Successful login regenerates the session ID. Sessions issued before auth hardening or before credential/session-secret rotation cannot be reused: log in again after the change and replace the cookie jar. Every admin request validates the session against the current configured credentials.

Browser writes, including login, logout, preview and commit, must originate from the same admin host. Cross-origin `Origin`/`Referer` or same-site/cross-site Fetch Metadata writes return `403`; read-only requests are not blocked by this check. Headerless cURL clients are supported. Login throttling is bounded and process-local: five attempts per client IP in a 15-minute window, with `429` and a `Retry-After` response header in seconds when throttled. Counters are not shared across server instances.

Use HTTPS outside local development. Keep login files, cookie jars, and preview responses private: previews include staff notes and original spreadsheet values. Never commit these files to source control or put real credentials in this guide or a shared terminal transcript.

## Endpoint reference

| Method | Path | Success | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | 200 JSON | Start an admin session |
| POST | `/api/auth/logout` | 200 JSON | End the session and clear its cookie |
| GET | `/api/imports/template` | 200 XLSX | Download a blank Places workbook |
| POST | `/api/imports/preview` | 200 JSON | Parse and persist a preview; no listings are created |
| POST | `/api/imports/{batchId}/commit` | 200 JSON | Create drafts from selected preview keys |
| GET | `/api/imports` | 200 JSON array | Latest 50 previews/import results, newest first |

### Workbook format and limits

- Upload a genuine `.xlsx` workbook, at most **5,242,880 bytes (5 MiB)**.
- Send raw file bytes, **not** multipart form data, JSON, or base64.
- Use `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- Set `X-File-Name` to the URL-encoded filename, including `.xlsx`. If absent, it defaults to `places.xlsx`. Only the basename is retained, up to 200 characters.
- Password-protected, macro-enabled, ZIP64, malformed, or excessively expanded archives are unsupported. The expanded archive safety limit is 40 MiB.
- At most 2,500 candidate place rows are supported. The parser also applies worksheet and archive complexity limits; acceptance depends on the workbook's structure, not just its compressed file size.

Two layouts are supported:

1. **Places template:** a sheet named `Places` with `Category`, `Name`, `Interest`, `Sub-Interest`, `Description`, `Location`, `Coordinates`, `Website`, `Phone`, and `Email` columns. Use comma-separated latitude/longitude in `Coordinates`, for example `10.66, -61.51`. Blank fields remain blank or null; incomplete places can still be imported for review.
2. **TTL multi-sheet layout:** Sites and Attractions, Sites and Attractions Verified, Nature, Tours, Nightlife, Food & Drink, Beaches, Wellness, Shopping, Stay, Business, Festivals, and Getting Around.

Canonical category values:

```text
nightlife, beaches, wellness, festivals, stay, transport,
business, tours, eat_drink, attractions, shopping
```

Nature maps to Attractions. Verified attraction entries supersede matching unverified entries where identity can be resolved safely. Specials sheets contain offers and are excluded. Events and reference/unsupported sheets are not place imports. Arbitrary layouts do not have an automatic column-mapping interface.

### Preview response

The complete response schema is in the OpenAPI file. Its top-level fields are:

| Field | Meaning |
|---|---|
| `batchId` | Persisted preview identifier used for commit |
| `fileName` | Stored source filename |
| `rows` | Deduplicated place candidates |
| `sheets` | Sheet summaries, categories and exclusion reasons |
| `skipped` | Source rows excluded during parsing |
| `notices` | Workbook-level review/exclusion notices |

Each preview row contains `key`, `sheet`, `rowNumber`, `verified`, `warnings`, `rawColumns`, and mapped place `data`. `existingId` is present when matched to an existing listing. Treat `key` as opaque and submit it unchanged.

`rawColumns` and warning/source information are **private admin review data**. Never forward the whole preview response to a public or mobile API.

An unsupported or empty workbook can produce zero candidate rows; a successful preview does not guarantee there is anything eligible to import.

### Commit request and response

Request body:

```json
{
  "keys": ["opaque-key-returned-in-preview"]
}
```

Send between 1 and 2,500 nonempty strings, each at most 300 characters. Every key must belong to the specified preview.

Example response (illustrative counts):

```json
{
  "batchId": 123,
  "importedCount": 2,
  "skippedCount": 3
}
```

Important behavior:

- Imported rows always have `status: "draft"`.
- Duplicate checks run again inside the commit transaction. Counts can change between preview and commit.
- Matching uses the import key, or normalized name/category plus a matching address or sufficiently close coordinates. Similar names at different locations remain review candidates unless other matching criteria identify them as duplicates.
- Existing listings are skipped, never updated.
- `skippedCount` includes parser exclusions, unselected preview rows, and rows skipped during commit. It is **not just the duplicate count**.
- A successful commit finalizes the batch, even if it creates zero drafts.
- Repeating a commit for a finalized batch returns its original counts and `alreadyImported: true`; it does not import a different selection. To import previously unselected rows, upload the workbook again, inspect the new preview and select the remaining eligible rows.
- A new upload creates a new preview/history entry. Re-uploading does not itself change existing listings.
- There is no preview-edit, resume-preview, or import-rollback endpoint. Edit imported listings through Draft Review; deleting an import history entry is not a supported undo operation.

### History response

`GET /api/imports` returns an array (no pagination wrapper) with at most 50 entries:

```json
[
  {
    "id": 123,
    "fileName": "places.xlsx",
    "status": "imported",
    "createdAt": "2026-09-30T12:00:00.000Z",
    "importedCount": 2,
    "skippedCount": 3
  }
]
```

`status` is currently `previewed` or `imported`. Previewed batches have zero committed counts. History summaries do not include preview rows.

## cURL walkthrough

Requires `curl` and `jq`. Run this on a trusted machine. Supply a protected login JSON file containing your own credentials; do not paste real credentials into chat.

### 1. Log in and save the session cookie

```sh
umask 077
WORK_DIR="$(mktemp -d)"
COOKIE_JAR="$WORK_DIR/cookies.txt"
LOGIN_JSON="/secure/path/admin-login.json"

curl --fail-with-body --silent --show-error \
  --cookie-jar "$COOKIE_JAR" \
  --header "Content-Type: application/json" \
  --data-binary "@$LOGIN_JSON" \
  "$BASE_URL/api/auth/login"
```

The login file has this structure, with placeholders replaced locally:

```json
{
  "email": "your-admin@example.com",
  "password": "YOUR_ADMIN_PASSWORD"
}
```

### 2. Download the template (optional)

```sh
curl --fail-with-body --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --output "$WORK_DIR/places-template.xlsx" \
  "$BASE_URL/api/imports/template"
```

### 3. Upload and preview

```sh
WORKBOOK="/path/to/places.xlsx"
ENCODED_NAME="$(basename "$WORKBOOK" | jq -sRr 'rtrimstr("\n") | @uri')"

curl --fail-with-body --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --header "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" \
  --header "X-File-Name: $ENCODED_NAME" \
  --data-binary "@$WORKBOOK" \
  --output "$WORK_DIR/preview.json" \
  "$BASE_URL/api/imports/preview"

jq '{
  batchId,
  candidates: (.rows | length),
  eligible: ([.rows[] | select(.existingId == null)] | length),
  skipped: (.skipped | length),
  notices
}' "$WORK_DIR/preview.json"
```

Before committing, inspect each row's mapped fields and warnings in the private preview or use the admin Bulk Import page. Do not interpret `verified` as publication approval.

### 4. Choose keys and commit

To select one reviewed row, copy its opaque key into `ROW_KEY`:

```sh
ROW_KEY="opaque-key-returned-in-preview"
jq -n --arg key "$ROW_KEY" '{keys: [$key]}' > "$WORK_DIR/selection.json"
```

Alternatively, **after reviewing the preview**, select all currently eligible rows:

```sh
jq '{keys: [.rows[] | select(.existingId == null) | .key]}' \
  "$WORK_DIR/preview.json" > "$WORK_DIR/selection.json"
```

Do not commit an empty selection. Then:

```sh
BATCH_ID="$(jq -er '.batchId' "$WORK_DIR/preview.json")"

curl --fail-with-body --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --header "Content-Type: application/json" \
  --data-binary "@$WORK_DIR/selection.json" \
  "$BASE_URL/api/imports/$BATCH_ID/commit"
```

### 5. Check history and review drafts

```sh
curl --fail-with-body --silent --show-error \
  --cookie "$COOKIE_JAR" \
  "$BASE_URL/api/imports" | jq .
```

Open `/drafts` on that same admin host to review imported listings. Saving edits keeps them drafts; **Publish reviewed listing** saves current edits and requests publication together. Publishing requires a valid category, nonblank name/interest/sub-interest/description, and either both coordinates absent or both finite and in range. Publication is separate from the import API.

Log out and remove temporary private files when finished:

```sh
curl --fail-with-body --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --request POST "$BASE_URL/api/auth/logout"
rm -rf -- "$WORK_DIR"
```

This removes only the temporary working directory, not your source workbook or login JSON file. Retain or remove that login file according to your credential-handling policy.

## Errors and retry guidance

Errors normally return `{ "message": "..." }`.

| Status | Cause |
|---|---|
| 400 | Invalid login shape; malformed/unsupported workbook; invalid filename; invalid batch ID, selection or unknown row key |
| 401 | Missing/expired admin session, a legacy session or one issued before credential/secret rotation, or invalid login credentials |
| 403 | Browser write rejected by the same-origin check, including login, logout and admin API writes |
| 404 | Commit references a preview that does not exist |
| 413 | Upload exceeds 5 MiB |
| 415 | Preview upload is not a raw XLSX body with the required content type |
| 429 | Process-local login rate limit reached; `Retry-After` gives the delay in seconds |
| 500 | Server, database or session-storage failure, including logout session-destruction failure |
| 503 | Login unavailable because admin configuration is missing or invalid |

Correct file/selection errors before retrying. For `401`, log in again after any hardening or credential/secret rotation. For `403`, make browser writes from the same admin origin. For login `429`, wait for `Retry-After`; for `503`, have an operator correct the environment configuration. Logout `500` means server-side session destruction failed even though the cookie is cleared; investigate the session store rather than assuming the server session was invalidated. If a commit response is lost, retry the **same batch and selection** after re-authenticating if necessary; a previously successful commit returns the saved result. A lost preview response requires re-uploading and produces another history entry.

Do not retry publication automatically or assume a draft is public because an import succeeded.

## Source of truth

- Routes and request validation: `server/imports/routes.ts`
- Transaction, duplicate matching and count semantics: `server/imports/service.ts`
- XLSX mapping/template: `server/imports/parser.ts`
- Upload safety checks: `server/imports/archive-guard.ts`
- Response contracts: `shared/import-types.ts`
- Session authentication: `server/auth.ts`