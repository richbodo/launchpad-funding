
-- ============================================================================
-- Security hardening (findings: investments_insert_email_spoofing,
-- session_logs_authenticated_read_all, event_images_missing_write_policies)
-- ============================================================================

-- 1. Per-participant session tokens ------------------------------------------
CREATE TABLE public.participant_sessions (
  token text PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES public.session_participants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  email text NOT NULL,
  role public.participant_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
GRANT ALL ON public.participant_sessions TO service_role;
ALTER TABLE public.participant_sessions ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: only accessed via SECURITY DEFINER RPCs.

CREATE INDEX participant_sessions_participant_idx ON public.participant_sessions(participant_id);
CREATE INDEX participant_sessions_expires_idx ON public.participant_sessions(expires_at);

-- 2. Internal helper: resolve token -> participant (service-only) ------------
CREATE OR REPLACE FUNCTION public._resolve_participant_token(_token text)
RETURNS TABLE(participant_id uuid, session_id uuid, email text, role public.participant_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ps.participant_id, ps.session_id, ps.email, ps.role
  FROM public.participant_sessions ps
  WHERE ps.token = _token AND ps.expires_at > now()
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public._resolve_participant_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._resolve_participant_token(text) TO service_role;

-- 3. Token mint by password (facilitators + any participant with credentials)
CREATE OR REPLACE FUNCTION public.mint_participant_token_by_password(
  _session_id uuid, _email text, _password text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _row record; _valid boolean; _token text;
BEGIN
  SELECT sp.id, sp.session_id, sp.email, sp.role INTO _row
  FROM public.session_participants sp
  WHERE sp.session_id = _session_id AND lower(sp.email) = lower(_email)
  ORDER BY sp.role = 'facilitator' DESC
  LIMIT 1;
  IF _row.id IS NULL THEN RETURN NULL; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.participant_credentials
    WHERE participant_id = _row.id
      AND password_hash = crypt(_password, password_hash)
  ) INTO _valid;
  IF NOT _valid THEN RETURN NULL; END IF;
  _token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.participant_sessions(token, participant_id, session_id, email, role)
  VALUES (_token, _row.id, _row.session_id, _row.email, _row.role);
  RETURN _token;
END $$;
REVOKE EXECUTE ON FUNCTION public.mint_participant_token_by_password(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_participant_token_by_password(uuid,text,text) TO anon, authenticated, service_role;

-- 4. Token mint by email (investors/startups; only when NO credentials exist)
CREATE OR REPLACE FUNCTION public.mint_participant_token_by_email(
  _session_id uuid, _email text, _role public.participant_role
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _row record; _has_cred boolean; _token text;
BEGIN
  IF _role = 'facilitator' THEN RETURN NULL; END IF;
  SELECT sp.id, sp.session_id, sp.email, sp.role INTO _row
  FROM public.session_participants sp
  WHERE sp.session_id = _session_id
    AND lower(sp.email) = lower(_email)
    AND sp.role = _role
  LIMIT 1;
  IF _row.id IS NULL THEN RETURN NULL; END IF;
  SELECT EXISTS(SELECT 1 FROM public.participant_credentials WHERE participant_id = _row.id) INTO _has_cred;
  IF _has_cred THEN RETURN NULL; END IF;
  _token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.participant_sessions(token, participant_id, session_id, email, role)
  VALUES (_token, _row.id, _row.session_id, _row.email, _row.role);
  RETURN _token;
END $$;
REVOKE EXECUTE ON FUNCTION public.mint_participant_token_by_email(uuid,text,public.participant_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_participant_token_by_email(uuid,text,public.participant_role) TO anon, authenticated, service_role;

-- 5. Write RPCs — server verifies the caller via token, never trusts client email
CREATE OR REPLACE FUNCTION public.submit_investment(
  _token text, _startup_email text, _startup_name text, _amount numeric, _pledge_type text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _p record; _iid uuid; _investor_name text;
BEGIN
  SELECT * INTO _p FROM public._resolve_participant_token(_token);
  IF _p.participant_id IS NULL THEN RAISE EXCEPTION 'Invalid or expired session' USING ERRCODE = '28000'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _pledge_type IS NULL OR _pledge_type NOT IN ('equity','gift') THEN RAISE EXCEPTION 'Invalid pledge type'; END IF;
  SELECT display_name INTO _investor_name FROM public.session_participants WHERE id = _p.participant_id;
  INSERT INTO public.investments(session_id, investor_email, investor_name, startup_email, startup_name, amount, pledge_type)
  VALUES (_p.session_id, _p.email, _investor_name, lower(_startup_email), _startup_name, _amount, _pledge_type)
  RETURNING id INTO _iid;
  INSERT INTO public.chat_messages(session_id, sender_email, sender_name, sender_role, message)
  VALUES (_p.session_id, _p.email, _investor_name, _p.role,
          '__COMMIT__::' || _amount::text || '::' || _startup_name || '::' || _pledge_type);
  INSERT INTO public.session_logs(session_id, event_type, event_data, actor_email)
  VALUES (_p.session_id, 'investment',
          jsonb_build_object('investor', _p.email, 'startup', lower(_startup_email), 'amount', _amount, 'pledge_type', _pledge_type),
          _p.email);
  RETURN _iid;
END $$;
REVOKE EXECUTE ON FUNCTION public.submit_investment(text,text,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_investment(text,text,text,numeric,text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_chat_message(_token text, _message text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _p record; _mid uuid; _name text;
BEGIN
  SELECT * INTO _p FROM public._resolve_participant_token(_token);
  IF _p.participant_id IS NULL THEN RAISE EXCEPTION 'Invalid or expired session' USING ERRCODE = '28000'; END IF;
  IF _message IS NULL OR length(btrim(_message)) = 0 THEN RAISE EXCEPTION 'Message required'; END IF;
  IF length(_message) > 2000 THEN RAISE EXCEPTION 'Message too long'; END IF;
  SELECT display_name INTO _name FROM public.session_participants WHERE id = _p.participant_id;
  INSERT INTO public.chat_messages(session_id, sender_email, sender_name, sender_role, message)
  VALUES (_p.session_id, _p.email, _name, _p.role, _message)
  RETURNING id INTO _mid;
  RETURN _mid;
END $$;
REVOKE EXECUTE ON FUNCTION public.post_chat_message(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_chat_message(text,text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_session_event(_token text, _event_type text, _event_data jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _p record; _lid uuid;
BEGIN
  SELECT * INTO _p FROM public._resolve_participant_token(_token);
  IF _p.participant_id IS NULL THEN RAISE EXCEPTION 'Invalid or expired session' USING ERRCODE = '28000'; END IF;
  IF _event_type IS NULL OR length(_event_type) = 0 OR length(_event_type) > 64 THEN RAISE EXCEPTION 'Invalid event_type'; END IF;
  INSERT INTO public.session_logs(session_id, event_type, event_data, actor_email)
  VALUES (_p.session_id, _event_type,
          COALESCE(_event_data, '{}'::jsonb) || jsonb_build_object('email', _p.email),
          _p.email)
  RETURNING id INTO _lid;
  RETURN _lid;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_session_event(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_session_event(text,text,jsonb) TO anon, authenticated, service_role;

-- 6. Lock down direct INSERT policies on the three write tables --------------
DROP POLICY IF EXISTS "Chat insertable by anon" ON public.chat_messages;
DROP POLICY IF EXISTS "Chat insertable by authenticated" ON public.chat_messages;
DROP POLICY IF EXISTS "Investments insertable by session participants" ON public.investments;
DROP POLICY IF EXISTS "Logs insertable by session participants" ON public.session_logs;
-- service_role bypasses RLS, so edge functions and RPCs (running as SECURITY
-- DEFINER owner = postgres/service) still write successfully.

-- 7. Tighten session_logs SELECT: authenticated readers can no longer read all
DROP POLICY IF EXISTS "Logs readable by authenticated" ON public.session_logs;
-- SELECT is now service_role only (via table-owner bypass); admin reads must
-- go through edge functions that use the service role key.

-- 8. Explicit storage policies for event-images bucket (defense-in-depth).
-- No anon/authenticated write policies means uploads are already denied.
-- These service_role policies are documentary; service_role bypasses RLS.
DROP POLICY IF EXISTS "event-images service_role insert" ON storage.objects;
DROP POLICY IF EXISTS "event-images service_role update" ON storage.objects;
DROP POLICY IF EXISTS "event-images service_role delete" ON storage.objects;
CREATE POLICY "event-images service_role insert" ON storage.objects
  FOR INSERT TO service_role WITH CHECK (bucket_id = 'event-images');
CREATE POLICY "event-images service_role update" ON storage.objects
  FOR UPDATE TO service_role USING (bucket_id = 'event-images') WITH CHECK (bucket_id = 'event-images');
CREATE POLICY "event-images service_role delete" ON storage.objects
  FOR DELETE TO service_role USING (bucket_id = 'event-images');
