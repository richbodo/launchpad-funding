CREATE TABLE IF NOT EXISTS public.participant_credentials (
  participant_id uuid PRIMARY KEY REFERENCES public.session_participants(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.participant_credentials TO service_role;
ALTER TABLE public.participant_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service write credentials" ON public.participant_credentials;
CREATE POLICY "service write credentials" ON public.participant_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.participant_credentials (participant_id, password_hash)
SELECT id, password_hash
FROM public.session_participants
WHERE password_hash IS NOT NULL
ON CONFLICT (participant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_participant_password(_participant_id uuid, _password text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.participant_credentials
    WHERE participant_id = _participant_id
      AND password_hash = crypt(_password, password_hash)
  )
$$;

CREATE OR REPLACE FUNCTION public.facilitator_has_password(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.session_participants sp
    JOIN public.participant_credentials pc ON pc.participant_id = sp.id
    WHERE sp.email = lower(_email)
      AND sp.role = 'facilitator'
  )
$$;

GRANT EXECUTE ON FUNCTION public.facilitator_has_password(text) TO anon, authenticated;

DROP TRIGGER IF EXISTS trg_hash_participant_password ON public.session_participants;
DROP TRIGGER IF EXISTS hash_participant_password_trigger ON public.session_participants;
DROP FUNCTION IF EXISTS public.hash_participant_password() CASCADE;
ALTER TABLE public.session_participants DROP COLUMN IF EXISTS password_hash;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_participants TO anon, authenticated;
GRANT ALL ON public.session_participants TO service_role;