
-- Grant full table SELECT, then revoke just password_hash
GRANT SELECT ON public.session_participants TO anon, authenticated;
REVOKE SELECT (password_hash) ON public.session_participants FROM anon, authenticated;
