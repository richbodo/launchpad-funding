DROP POLICY IF EXISTS "Sessions are insertable by authenticated" ON public.sessions;
CREATE POLICY "Sessions insertable by all"
  ON public.sessions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Sessions are deletable by authenticated" ON public.sessions;
CREATE POLICY "Sessions deletable by all"
  ON public.sessions FOR DELETE USING (true);