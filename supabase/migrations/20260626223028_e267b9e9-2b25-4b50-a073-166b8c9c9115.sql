
CREATE OR REPLACE FUNCTION public.get_session_participants(_session_id uuid, _email text)
RETURNS SETOF public.session_participants
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _session_id IS NULL OR _email IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants sp
    WHERE sp.session_id = _session_id
      AND sp.email = lower(_email)
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT * FROM public.session_participants
    WHERE session_id = _session_id
    ORDER BY role ASC, presentation_order ASC NULLS LAST, display_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_session_participants(uuid, text) TO anon, authenticated;
