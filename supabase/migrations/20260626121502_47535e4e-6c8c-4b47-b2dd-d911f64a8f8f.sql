-- Tighten public read of session_participants. Previously anyone on the
-- internet could read every participant email across every session.
-- Now anon reads are scoped to sessions whose status is 'scheduled' or 'live'.
-- Completed and draft sessions are no longer enumerable from the client;
-- admin views for those go through service-role edge functions.
DROP POLICY IF EXISTS "Participants are readable by everyone" ON public.session_participants;

CREATE POLICY "Participants readable for active sessions"
ON public.session_participants
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = session_participants.session_id
      AND s.status IN ('scheduled', 'live')
  )
);