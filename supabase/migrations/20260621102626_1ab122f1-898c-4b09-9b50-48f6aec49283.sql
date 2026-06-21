ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS pledge_type text NOT NULL DEFAULT 'equity';

ALTER TABLE public.investments
  DROP CONSTRAINT IF EXISTS investments_pledge_type_check;
ALTER TABLE public.investments
  ADD CONSTRAINT investments_pledge_type_check
  CHECK (pledge_type IN ('equity','gift'));

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS investor_class text;

ALTER TABLE public.session_participants
  DROP CONSTRAINT IF EXISTS session_participants_investor_class_check;
ALTER TABLE public.session_participants
  ADD CONSTRAINT session_participants_investor_class_check
  CHECK (investor_class IS NULL OR investor_class IN ('accredited','community'));