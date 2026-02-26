-- Drop the restrictive INSERT policies and replace with permissive ones
DROP POLICY IF EXISTS "Participants insertable by authenticated" ON public.session_participants;

CREATE POLICY "Participants insertable by all"
ON public.session_participants
FOR INSERT
WITH CHECK (true);

-- Also fix the anon update policy (it's restrictive too)
DROP POLICY IF EXISTS "Anon can update login status" ON public.session_participants;

CREATE POLICY "Anon can update login status"
ON public.session_participants
FOR UPDATE
USING (true);

-- Fix the authenticated update policy
DROP POLICY IF EXISTS "Participants updatable by authenticated" ON public.session_participants;

CREATE POLICY "Participants updatable by all"
ON public.session_participants
FOR UPDATE
USING (true);

-- Fix the delete policy
DROP POLICY IF EXISTS "Participants deletable by authenticated" ON public.session_participants;

CREATE POLICY "Participants deletable by all"
ON public.session_participants
FOR DELETE
USING (true);