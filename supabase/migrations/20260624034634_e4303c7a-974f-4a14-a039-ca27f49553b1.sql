-- Tighten investments INSERT policy: require investor_email to match a real
-- participant in the same session (mirrors the chat_messages pattern).
DROP POLICY IF EXISTS "Investments insertable when session exists" ON public.investments;

CREATE POLICY "Investments insertable by session participants"
ON public.investments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.session_participants sp
    WHERE sp.session_id = investments.session_id
      AND sp.email = lower(investments.investor_email)
  )
);

-- Tighten session_logs INSERT policy: actor_email must belong to a participant
-- in the same session, preventing spoofed audit entries from anonymous clients.
DROP POLICY IF EXISTS "Logs insertable when session exists" ON public.session_logs;

CREATE POLICY "Logs insertable by session participants"
ON public.session_logs
FOR INSERT
WITH CHECK (
  actor_email IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.session_participants sp
    WHERE sp.session_id = session_logs.session_id
      AND sp.email = lower(session_logs.actor_email)
  )
);