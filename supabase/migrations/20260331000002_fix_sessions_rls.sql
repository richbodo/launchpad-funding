-- Fix: sessions UPDATE policy was restricted to 'authenticated' role,
-- but the app uses the anon key (no Supabase Auth). This caused
-- handleStartCall/handleEndCall to silently fail (zero rows updated).
-- See issue #9.

DROP POLICY IF EXISTS "Sessions are updatable by authenticated" ON public.sessions;

CREATE POLICY "Sessions updatable by all"
  ON public.sessions FOR UPDATE USING (true);
