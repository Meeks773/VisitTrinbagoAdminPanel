# VisitTrinbago Content Management System

## Overview
Admin web application for managing tourism content displayed in the VisitTrinbago mobile app. Supports 8 content categories with full CRUD operations and exposes a public API for mobile app consumption.

## Architecture
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui components
- **Backend**: Express.js REST API
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: wouter (frontend), Express (backend)
- **State**: TanStack React Query

## Categories
nightlife, beaches, wellness, festivals, stay, transport, business, tours, eat_drink, attractions, shopping

## Data Model
Single `listings` table with common fields (name, interest, subInterest, description, featuredImage, galleryImages, location, lat/lng, website, phone, email, rewardPoints) plus a JSONB `metadata` column for category-specific fields.

## Image Uploads
- Uses Replit Object Storage (GCS-backed) for image storage
- Presigned URL upload flow: POST /api/uploads/request-url → PUT to presigned URL
- Images served via GET /objects/* route
- Featured image (single) and gallery images (multiple) supported per listing
- Object storage integration files in server/replit_integrations/object_storage/
- Upload components in client/src/components/image-upload.tsx

## API Endpoints
- `GET /api/listings?category=xxx` - Admin listing retrieval
- `GET /api/listings/:id` - Single listing
- `POST /api/listings` - Create listing
- `PATCH /api/listings/:id` - Update listing
- `DELETE /api/listings/:id` - Delete listing
- `GET /api/public/listings?category=xxx` - Public API for mobile app
- `GET /api/public/listings/:id` - Public single listing

## Key Files
- `shared/schema.ts` - Database schema & types
- `server/routes.ts` - API routes
- `server/storage.ts` - Database operations
- `server/seed.ts` - Seed data
- `client/src/lib/category-config.ts` - Category field configurations
- `client/src/components/listing-form.tsx` - Dynamic form builder
- `client/src/pages/category-page.tsx` - Category CRUD page
- `client/src/pages/dashboard.tsx` - Dashboard overview

## Running
`npm run dev` starts Express + Vite dev server on port 5000.
