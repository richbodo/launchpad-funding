
-- Drop the wide-open write policies on sessions, session_participants, app_settings.
-- Reads remain public (a separate SELECT policy already exists on each table).

DROP POLICY IF EXISTS "Sessions insertable"   ON public.sessions;
DROP POLICY IF EXISTS "Sessions updatable"    ON public.sessions;
DROP POLICY IF EXISTS "Sessions deletable"    ON public.sessions;

DROP POLICY IF EXISTS "Participants insertable" ON public.session_participants;
DROP POLICY IF EXISTS "Participants can update" ON public.session_participants;
DROP POLICY IF EXISTS "Participants deletable"  ON public.session_participants;

DROP POLICY IF EXISTS "App settings insertable" ON public.app_settings;
DROP POLICY IF EXISTS "App settings updatable"  ON public.app_settings;

-- Revoke direct DML privileges from anon/authenticated. With RLS enabled and
-- no permissive policy, the REST API will return an empty result for missing
-- privileges; revoking the underlying GRANTs makes the denial explicit.
REVOKE INSERT, UPDATE, DELETE ON public.sessions             FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.session_participants FROM anon, authenticated;
REVOKE INSERT, UPDATE             ON public.app_settings     FROM anon, authenticated;

-- Service role keeps full access (edge functions use it).
GRANT  INSERT, UPDATE, DELETE ON public.sessions             TO service_role;
GRANT  INSERT, UPDATE, DELETE ON public.session_participants TO service_role;
GRANT  INSERT, UPDATE, DELETE ON public.app_settings         TO service_role;

-- Add explicit service-role-only write policies so intent is documented in pg_policies.
CREATE POLICY "Sessions service write" ON public.sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Participants service write" ON public.session_participants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "App settings service write" ON public.app_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
