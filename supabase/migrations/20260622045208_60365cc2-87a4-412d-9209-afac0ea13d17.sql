ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS bio text;

ALTER TABLE public.session_participants
  DROP CONSTRAINT IF EXISTS session_participants_bio_length_chk;
ALTER TABLE public.session_participants
  ADD CONSTRAINT session_participants_bio_length_chk
  CHECK (bio IS NULL OR char_length(bio) <= 500);