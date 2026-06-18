ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS email_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_cancelled_at timestamptz;

ALTER TABLE public.investments
  DROP CONSTRAINT IF EXISTS investments_email_status_check;
ALTER TABLE public.investments
  ADD CONSTRAINT investments_email_status_check
  CHECK (email_status IN ('draft','queued','sent','cancelled'));

CREATE INDEX IF NOT EXISTS investments_session_email_status_idx
  ON public.investments (session_id, email_status);