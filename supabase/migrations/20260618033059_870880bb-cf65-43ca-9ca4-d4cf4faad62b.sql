-- ============================================================================
-- Security hardening pass: lock down writes on sessions, session_participants,
-- app_settings, and the chat-archives storage bucket. Hide password_hash from
-- client reads via column-level grants. Route presence flips through a
-- SECURITY DEFINER RPC so logging in/out doesn't need a permissive UPDATE.
-- ============================================================================

-- ── sessions: only service_role can write ────────────────────────────────────
DROP POLICY IF EXISTS "Sessions deletable by all" ON public.sessions;
DROP POLICY IF EXISTS "Sessions insertable by all" ON public.sessions;
DROP POLICY IF EXISTS "Sessions are updatable by authenticated" ON public.sessions;
REVOKE INSERT, UPDATE, DELETE ON public.sessions FROM anon, authenticated;
GRANT ALL ON public.sessions TO service_role;
-- SELECT policy "Sessions are readable by everyone" remains.

-- ── session_participants: writes locked, password_hash hidden ────────────────
DROP POLICY IF EXISTS "Anon can read participants" ON public.session_participants;
DROP POLICY IF EXISTS "Participants readable by all" ON public.session_participants;
DROP POLICY IF EXISTS "Participants insertable by all" ON public.session_participants;
DROP POLICY IF EXISTS "Participants can update login status" ON public.session_participants;
DROP POLICY IF EXISTS "Participants deletable by all" ON public.session_participants;
DROP POLICY IF EXISTS "Participants deletable by all" ON public.session_participants;

CREATE POLICY "Participants are readable by everyone"
  ON public.session_participants FOR SELECT
  USING (true);

REVOKE ALL ON public.session_participants FROM anon, authenticated;
GRANT SELECT (
  id, session_id, email, role, display_name, presentation_order,
  is_logged_in, logged_in_at, created_at, dd_room_link, website_link, funding_goal
) ON public.session_participants TO anon, authenticated;
GRANT ALL ON public.session_participants TO service_role;

-- Presence helper — lets the client flip is_logged_in/logged_in_at without an
-- UPDATE policy. SECURITY DEFINER runs with table-owner privileges so it
-- bypasses RLS; we constrain it to two specific columns.
CREATE OR REPLACE FUNCTION public.set_participant_presence(_participant_id uuid, _logged_in boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.session_participants
  SET is_logged_in = _logged_in,
      logged_in_at = CASE WHEN _logged_in THEN now() ELSE logged_in_at END
  WHERE id = _participant_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_participant_presence(uuid, boolean) TO anon, authenticated;

-- ── app_settings: reads public, writes service_role only ─────────────────────
DROP POLICY IF EXISTS "App settings insertable by all" ON public.app_settings;
DROP POLICY IF EXISTS "App settings updatable by all" ON public.app_settings;
REVOKE INSERT, UPDATE, DELETE ON public.app_settings FROM anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
-- SELECT policy "App settings readable by all" remains (used by useDemoMode).

-- ── chat-archives storage bucket: no public access ───────────────────────────
DROP POLICY IF EXISTS "Chat archives are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Chat archives uploadable by authenticated" ON storage.objects;
DROP POLICY IF EXISTS "Chat archives deletable by authenticated" ON storage.objects;
-- service_role bypasses storage RLS; the archive-chat and chat-archives-list
-- edge functions use service_role and signed URLs.