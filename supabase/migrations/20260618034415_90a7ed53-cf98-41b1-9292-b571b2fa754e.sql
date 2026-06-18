
-- 1) Set search_path on email queue helper functions (warn: function_search_path_mutable)
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, int, int) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;

-- 2) Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated/PUBLIC.
--    All callers are edge functions running as service_role, or triggers.
REVOKE EXECUTE ON FUNCTION public.verify_participant_password(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hash_participant_password() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_participant_presence(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_participant_password(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_participant_presence(uuid, boolean) TO service_role;

-- 3) Replace permissive WITH CHECK (true) INSERT policies with checks tied
--    to a real session row. Still allows anonymous writes (no auth in this
--    app) but eliminates the "always true" finding and rejects orphan rows.

DROP POLICY IF EXISTS "Investments insertable by anon" ON public.investments;
DROP POLICY IF EXISTS "Investments insertable by authenticated" ON public.investments;
CREATE POLICY "Investments insertable when session exists"
ON public.investments
FOR INSERT
TO anon, authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = investments.session_id));

DROP POLICY IF EXISTS "Logs insertable by anon" ON public.session_logs;
DROP POLICY IF EXISTS "Logs insertable by authenticated" ON public.session_logs;
CREATE POLICY "Logs insertable when session exists"
ON public.session_logs
FOR INSERT
TO anon, authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_logs.session_id));
