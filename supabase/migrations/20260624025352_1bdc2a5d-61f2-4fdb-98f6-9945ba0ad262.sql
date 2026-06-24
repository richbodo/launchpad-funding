CREATE OR REPLACE FUNCTION public.set_participant_password(_participant_id uuid, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  INSERT INTO public.participant_credentials (participant_id, password_hash, updated_at)
  VALUES (_participant_id, crypt(_password, gen_salt('bf', 10)), now())
  ON CONFLICT (participant_id)
  DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();
END;
$$;

-- Only service_role (edge functions) should call this. Do NOT grant to anon/authenticated.
REVOKE ALL ON FUNCTION public.set_participant_password(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_participant_password(uuid, text) TO service_role;