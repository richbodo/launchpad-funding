-- Revoke column-level access to password_hash so it cannot be selected by anon/authenticated clients.
-- The verify_participant_password and hash_participant_password SECURITY DEFINER functions
-- still operate on this column server-side.
REVOKE SELECT (password_hash) ON public.session_participants FROM anon, authenticated, PUBLIC;
REVOKE UPDATE (password_hash), INSERT (password_hash) ON public.session_participants FROM anon, authenticated, PUBLIC;

-- Ensure service_role retains full access (used by edge functions / admin code).
GRANT ALL ON public.session_participants TO service_role;