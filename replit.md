# VisitTrinbago Content Management System

## Overview
Admin web application for managing tourism content displayed in the VisitTrinbago mobile app. Supports 11 content categories with full CRUD operations and exposes a public API for mobile app consumption. Bold red/black/white brand aesthetic with Montserrat font.

## Architecture
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui components
- **Backend**: Express.js REST API
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: wouter (frontend), Express (backend)
- **State**: TanStack React Query
- **Design**: Bold poster-inspired aesthetic — Montserrat font, uppercase typography, red/black/white palette

## Categories
nightlife, beaches, wellness, festivals, stay, transport, business, tours, eat_drink, attractions, shopping

## Data Model
- **listings** table: common fields (name, interest, subInterest, description, featuredImage, galleryImages, location, lat/lng, website, phone, email, rewardPoints) plus a JSONB `metadata` column for category-specific fields.
- **events** table: event calendar entries with fields (name, eventCategory, interest, subInterest, description, startDateTime, endDateTime, location, lat/lng, isFreeEvent, featuredImage, galleryImages, videoUrls, website, bookingUrl, organizerName, phone, email, dressCode, rewardPoints).
- Event categories: Concert, Festival, Exhibition, Workshop, Sports, Cultural, Food & Drink, Community, Conference, Carnival, Religious, Other

## Image Uploads
- Uses Replit Object Storage (GCS-backed) for image storage
- Presigned URL upload flow: POST /api/uploads/request-url → PUT to presigned URL
- Images served via GET /objects/* route
- Featured image (single) and gallery images (multiple) supported per listing
- Object storage integration files in server/replit_integrations/object_storage/
- Upload components in client/src/components/image-upload.tsx

## Bulk Place Import and Draft Review
- API guide and cURL examples: `docs/admin-import-api.md`; OpenAPI 3.0.3 specification: `docs/admin-import.openapi.json`.
- Admin routes `/imports` and `/drafts` support TTL multi-sheet XLSX submissions and the downloadable Places template (5 MB limit).
- Upload → preview and select → create drafts; existing places are not overwritten. Repeated imports are idempotent, with location-aware matching so separate branches remain separate.
- `server/imports/` contains the parser, archive guard, import transaction, and authenticated API routes.
- `listings.status` defaults to published for existing/manual content; imported rows explicitly use draft. Public detail/list/search/nearby/category counts include only published listings.
- Private source values, verification notes, and warnings are stored in `import_details`, not public metadata. Public responses exclude all import provenance.
- Verified attraction rows supersede matching unverified rows. Nature maps to Attractions. Reference sheets, offers, and empty Events are not imported as places.
- Review edits can be saved as drafts or saved and published together; incomplete required fields block publication. Blank coordinates remain null.
- `import_batches` records previews and results. API: `GET /api/imports`, `GET /api/imports/template`, `POST /api/imports/preview` (raw XLSX and encoded `X-File-Name`), `POST /api/imports/:id/commit` with selected row keys.
- Development imports do not alter production data. Publish schema changes normally; use Bulk Import on the live admin to load live drafts.
- Regression checks: `npx tsx --test script/import-parser.test.ts script/draft-visibility.test.ts script/import-service.test.ts`. The service suite uses temporary development records and cleans them up.

## Admin API Endpoints
- `GET /api/listings?category=xxx` - Admin listing retrieval
- `GET /api/listings/:id` - Single listing
- `POST /api/listings` - Create listing
- `PATCH /api/listings/:id` - Update listing
- `DELETE /api/listings/:id` - Delete listing

## Events Admin API Endpoints
- `GET /api/events` - List all events
- `GET /api/events/:id` - Single event
- `POST /api/events` - Create event
- `PATCH /api/events/:id` - Update event
- `DELETE /api/events/:id` - Delete event

## Public API Endpoints (Mobile App)
All public endpoints are read-only and require no authentication.

### Categories Overview
- `GET /api/public/categories` - All categories with listing counts

### Listings (paginated, filterable, sortable)
- `GET /api/public/listings` - Browse listings with query params:
  - `category` - Filter by category (e.g. nightlife, beaches)
  - `search` - Search by name, description, sub-interest, location
  - `subInterest` - Filter by sub-interest
  - `sort` - Sort by: name, reward_points, newest (default), distance
  - `page` - Page number (default: 1)
  - `limit` - Items per page (default: 20, max: 100)
  - `lat` & `lng` - Center point for nearby search
  - `radius` - Radius in km (default: 25)

### Single Listing
- `GET /api/public/listings/:id` - Get full listing details

### Search (convenience)
- `GET /api/public/search?q=xxx` - Search across all categories
  - `page` and `limit` supported

### Nearby (convenience)
- `GET /api/public/nearby?lat=xxx&lng=xxx` - Find nearby listings
  - `radius` - km radius (default: 25)
  - `category` - optional category filter
  - `page` and `limit` supported

### Events (paginated, filterable, sortable)
- `GET /api/public/events` - Browse events with query params:
  - `eventCategory` - Filter by event category (e.g. Concert, Festival, Carnival)
  - `search` - Search by name, description, location, organizer
  - `startDate` - Filter events starting on or after this ISO date
  - `endDate` - Filter events starting on or before this ISO date
  - `sort` - Sort by: name, date (default, chronological), newest
  - `page` - Page number (default: 1)
  - `limit` - Items per page (default: 20, max: 100)

### Single Event
- `GET /api/public/events/:id` - Get full event details

### Event Categories
- `GET /api/public/events/categories/list` - List all event category names

### Response Format
All paginated endpoints return:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasMore": true
  }
}
```

## AI Content Generation
- Uses Replit AI Integrations (OpenAI-compatible, no separate API key needed)
- `POST /api/ai/generate-listing` - Takes `name` and `category`, returns all fields populated with tourist-friendly content
- `POST /api/ai/generate-event` - Takes `name` and `eventCategory`, returns all event fields populated with content
- `POST /api/events/populate` - Takes `startDate` and `endDate` (ISO strings), uses Perplexity AI to search the web for real upcoming T&T events, fetches Pexels images, and bulk-creates events
- Model: gpt-5-mini with JSON response format
- Category-aware: knows the exact metadata fields for each of the 11 categories
- Descriptions are written in travel-guide tone with sensory details and local flavor
- Coordinates are generated within realistic Trinidad and Tobago ranges
- Auto-fetches cover + gallery images from Pexels (free stock photo API) and uploads to object storage
- Frontend: "AI Generate" button in listing form — user types name, clicks generate, all fields + images auto-fill
- Integration files in server/replit_integrations/ (chat, audio, image, batch utilities)
- Requires PEXELS_API_KEY secret for image search (free at pexels.com/api)

## Analytics
- Admin-only analytics page at `/analytics` with two sections: Content (computed from existing data) and Mobile App API Usage (from request logs)
- `GET /api/analytics` returns: totals (listings, events, upcoming/past, free/paid, reward points + averages), listings by category, events by category, data quality (missing website/phone/coords/featured image/gallery, short descriptions), geographic split (Trinidad vs Tobago by latitude ≥11.0), top reward listings/events, content created over last 12 months, upcoming events grouped by week (next 12 weeks), and top organizers
- `GET /api/analytics/usage` returns mobile app API traffic: totals (24h/7d/30d, unique IPs, avg response time, error rate), requests-per-day for last 30 days, top routes, most-viewed listings/events, top searches, popular categories/event categories, nearby search hotspots (lat/lng rounded to 2dp). Returns `hasData: false` when log table is empty.
- Frontend uses recharts for line/bar charts; admin frontend page at `client/src/pages/analytics-page.tsx`
- Page is organized into 4 tabs: **Overview** (KPI strip + content created + upcoming events + top organizers), **Content** (listings by category, events by category pie, geographic split, free vs paid, top reward listings/events), **Quality** (data completeness progress bars), **API Usage** (mobile traffic from `/api/analytics/usage`)
- Sidebar link "Analytics" sits under Overview group

## Public API Request Logging
- `api_requests` table logs every `/api/public/*` request (path, normalized routeKey, method, status, category, eventCategory, listingId, eventId, search query, lat/lng, durationMs, ip, userAgent)
- Logged via Express middleware on `res.on("finish")` — non-blocking, fire-and-forget DB insert
- Mounted before public routes in `server/routes.ts`; aggregations live in `storage.getUsageAnalytics()`

## Key Files
- `shared/schema.ts` - Database schema & types
- `server/routes.ts` - API routes (admin + public)
- `server/storage.ts` - Database operations
- `server/seed.ts` - Seed data
- `client/src/lib/category-config.ts` - Category field configurations
- `client/src/components/listing-form.tsx` - Dynamic form builder
- `client/src/pages/category-page.tsx` - Category listing page
- `client/src/pages/listing-form-page.tsx` - Full-page add/edit form (animated)
- `client/src/pages/dashboard.tsx` - Dashboard overview
- `client/src/pages/events-page.tsx` - Events list page
- `client/src/pages/event-form-page.tsx` - Event add/edit form page
- `client/src/components/event-form.tsx` - Event form component
- `client/src/components/event-card.tsx` - Event card component

## Authentication
- Custom single-admin authentication uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables; no credentials are stored in source or documentation.
- `ADMIN_EMAIL` must be a valid email address. `ADMIN_PASSWORD` must have at least 16 non-padding characters (maximum 4096); comparisons preserve the exact password.
- `SESSION_SECRET` must have at least 32 non-padding characters. Retain the shared existing session secret if it is valid; there is no fallback secret. A missing or invalid secret fails startup clearly.
- Missing or invalid admin credentials disable login with HTTP 503 without disabling the public app.
- Session-based using `express-session` + `connect-pg-simple` (PostgreSQL store, table `user_sessions` auto-created)
- Successful login regenerates the session ID. Credential-bound HMAC versions reject legacy sessions and sessions issued before credential or session-secret rotation; log in again after hardening or rotation.
- Cookie: httpOnly, sameSite=lax, 30 day max age, `secure` only in production
- Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `requireAuth` middleware is mounted at `/api` and gates everything **except** `/api/auth/*` and `/api/public/*`; upload issuance also explicitly requires an admin session.
- `/objects/*` access requires a valid admin session OR an exact image reference from a published listing/public event; the originals namespace is always admin-only.
- Browser API writes must be same-origin; cross-origin Origin/Referer or same-site/cross-site Fetch Metadata writes return HTTP 403. Read-only requests and headerless cURL clients are allowed.
- Login has a bounded, process-local rate limit of five attempts per client IP per 15 minutes; HTTP 429 includes `Retry-After` in seconds.
- Frontend: `AuthProvider` (`client/src/hooks/use-auth.tsx`) loads `/api/auth/me` on boot, `AuthGate` in `App.tsx` redirects unauthenticated users to `/login`, sidebar footer shows current user + Sign Out button
- Login page at `/login` (`client/src/pages/login-page.tsx`)

## Running
`npm run dev` starts Express + Vite dev server on port 5000.
