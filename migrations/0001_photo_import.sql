-- Additive CMS migration for the reviewed photo-import workflow.
-- Development database only. Replit Publish applies the resulting schema diff
-- to managed production; never run this at application startup or deploy build.
BEGIN;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS photo_media jsonb;

CREATE TABLE IF NOT EXISTS photo_import_batches (
  id varchar(36) PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'reviewed', 'applied', 'restored')),
  file_count integer NOT NULL DEFAULT 0
    CHECK (file_count >= 0 AND file_count <= 2500),
  batch jsonb NOT NULL
    CHECK (jsonb_typeof(batch) = 'object'),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_import_batches_created_at_idx
  ON photo_import_batches (created_at DESC);

COMMIT;