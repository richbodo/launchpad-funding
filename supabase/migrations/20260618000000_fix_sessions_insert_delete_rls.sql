-- Fix: the sessions INSERT and DELETE policies were restricted to the
-- 'authenticated' role, but this app uses the anon publishable key (it has no
-- Supabase Auth). Every request therefore arrives as the 'anon' role, so the
-- Admin "Create Session" insert was rejected with:
--   new row violates row-level security policy for table "sessions"  (code 42501)
--
-- This is the root cause of session creation failing in production. The chosen
-- timezone was never relevant. Demo mode was unaffected because demo sessions are
-- seeded server-side by the seed-demo-data Edge Function using the service-role
-- key, which bypasses RLS entirely.
--
-- This mirrors 20260331000002_fix_sessions_rls.sql, which already fixed the exact
-- same problem for UPDATE. Facilitator access is gated in the application layer
-- (facilitator password), consistent with the rest of this project's permissive
-- RLS model (see "Participants insertable by all", "App settings insertable by
-- all", etc.).

DROP POLICY IF EXISTS "Sessions are insertable by authenticated" ON public.sessions;
CREATE POLICY "Sessions insertable by all"
  ON public.sessions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Sessions are deletable by authenticated" ON public.sessions;
CREATE POLICY "Sessions deletable by all"
  ON public.sessions FOR DELETE USING (true);
