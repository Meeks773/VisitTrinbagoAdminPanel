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

## Running
`npm run dev` starts Express + Vite dev server on port 5000.
