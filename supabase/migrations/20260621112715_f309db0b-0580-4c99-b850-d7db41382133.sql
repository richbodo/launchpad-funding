-- Issue #44: Event landing page + investor self-signup

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS max_attendees integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_full boolean NOT NULL DEFAULT false;

-- Backfill slugs for existing sessions using the first 8 chars of the id.
UPDATE public.sessions
SET slug = lower(substr(replace(id::text, '-', ''), 1, 8))
WHERE slug IS NULL;

-- Enforce uniqueness now that all rows have a value.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_slug_unique ON public.sessions (slug)
  WHERE slug IS NOT NULL;

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS image_url text;

-- Helpful index for cap-check queries.
CREATE INDEX IF NOT EXISTS session_participants_session_role_approved_idx
  ON public.session_participants (session_id, role, approved);
