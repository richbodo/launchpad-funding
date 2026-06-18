
-- Restore write policies and grants that were lost
DROP POLICY IF EXISTS "Participants can update login status" ON public.session_participants;
CREATE POLICY "Participants can update" ON public.session_participants
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Participants insertable" ON public.session_participants;
CREATE POLICY "Participants insertable" ON public.session_participants
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Participants deletable" ON public.session_participants;
CREATE POLICY "Participants deletable" ON public.session_participants
  FOR DELETE TO anon, authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_participants TO anon, authenticated;
GRANT ALL ON public.session_participants TO service_role;

-- Sessions: restore write policies (admin UI uses these from the client too)
DROP POLICY IF EXISTS "Sessions insertable" ON public.sessions;
CREATE POLICY "Sessions insertable" ON public.sessions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Sessions updatable" ON public.sessions;
CREATE POLICY "Sessions updatable" ON public.sessions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Sessions deletable" ON public.sessions;
CREATE POLICY "Sessions deletable" ON public.sessions
  FOR DELETE TO anon, authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO anon, authenticated;
GRANT ALL ON public.sessions TO service_role;

-- Investments: restore UPDATE/DELETE if needed (already has SELECT/INSERT)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investments TO anon, authenticated;
GRANT ALL ON public.investments TO service_role;

-- app_settings updatable from admin UI
DROP POLICY IF EXISTS "App settings updatable" ON public.app_settings;
CREATE POLICY "App settings updatable" ON public.app_settings
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "App settings insertable" ON public.app_settings;
CREATE POLICY "App settings insertable" ON public.app_settings
  FOR INSERT TO anon, authenticated WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
