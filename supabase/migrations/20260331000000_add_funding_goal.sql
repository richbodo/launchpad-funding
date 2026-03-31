-- Add funding_goal column to session_participants (meaningful for startup role only)
ALTER TABLE public.session_participants
  ADD COLUMN funding_goal NUMERIC(12,2);
