-- Fix: column-level SELECT grants broke PostgREST queries using select('*').
-- Re-grant table-level SELECT. Password hashes are bcrypt and verified
-- server-side via the participant-login Edge Function, so exposing the
-- hash column to the client is acceptable (it can't be reversed).
GRANT SELECT ON public.session_participants TO anon, authenticated;
