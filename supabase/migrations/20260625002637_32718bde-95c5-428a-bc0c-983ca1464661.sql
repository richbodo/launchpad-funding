
-- Lock down public reads of email PII on chat_messages and investments.
-- Replace permissive "readable by all" SELECT policies with service-role-only,
-- then expose gated SECURITY DEFINER RPCs that only return rows to a caller
-- who proves they are a participant of the session by email.

DROP POLICY IF EXISTS "Chat readable by all" ON public.chat_messages;
DROP POLICY IF EXISTS "Investments readable by all" ON public.investments;

-- Service role retains full read access (edge functions, admin tooling).
CREATE POLICY "Chat readable by service_role"
ON public.chat_messages
FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Investments readable by service_role"
ON public.investments
FOR SELECT
TO service_role
USING (true);

-- Gated RPC: chat history for a session, only if caller is a participant.
CREATE OR REPLACE FUNCTION public.get_session_chat_messages(
  _session_id uuid,
  _email text,
  _limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  sender_email text,
  sender_name text,
  sender_role participant_role,
  message text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    SELECT cm.id, cm.sender_email, cm.sender_name, cm.sender_role, cm.message, cm.created_at
    FROM public.chat_messages cm
    WHERE cm.session_id = _session_id
    ORDER BY cm.created_at DESC
    LIMIT LEAST(COALESCE(_limit, 200), 500);
END;
$$;

-- Gated RPC: investments for a session, only if caller is a participant.
CREATE OR REPLACE FUNCTION public.get_session_investments(
  _session_id uuid,
  _email text
)
RETURNS SETOF public.investments
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    SELECT * FROM public.investments
    WHERE session_id = _session_id
    ORDER BY created_at DESC;
END;
$$;

-- Allow anon + authenticated clients to call the gated RPCs.
GRANT EXECUTE ON FUNCTION public.get_session_chat_messages(uuid, text, integer)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_investments(uuid, text)
  TO anon, authenticated;
