-- Idempotent guard: public.session_participants is already added to the
-- supabase_realtime publication by 20260331000001_add_participants_realtime.sql.
-- On a clean `supabase db reset` this duplicate ADD fails with
-- "relation ... is already member of publication" (SQLSTATE 42710), which
-- aborts the whole reset. Postgres has no "ADD TABLE IF NOT EXISTS" for
-- publications, so guard it explicitly. (In environments where this migration
-- was already applied, it is recorded by version and will not re-run.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'session_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_participants;
  END IF;
END $$;
