-- Track when a participant's invitation email was last queued, so the admin
-- "Send emails" control can skip people who have already been emailed and show
-- a per-participant sent status.
ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;
