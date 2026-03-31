
-- Enable pgcrypto extension in extensions schema
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- Create a function to verify participant passwords securely (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.verify_participant_password(
  _participant_id uuid,
  _password text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.session_participants
    WHERE id = _participant_id
      AND password_hash = crypt(_password, password_hash)
  )
$$;

-- Create trigger function to auto-hash passwords on insert/update
CREATE OR REPLACE FUNCTION public.hash_participant_password()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.password_hash IS NOT NULL AND NEW.password_hash NOT LIKE '$2%' THEN
    NEW.password_hash := crypt(NEW.password_hash, gen_salt('bf', 10));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hash_participant_password
BEFORE INSERT OR UPDATE OF password_hash
ON public.session_participants
FOR EACH ROW
EXECUTE FUNCTION public.hash_participant_password();

-- Hash all existing plaintext passwords
UPDATE public.session_participants
SET password_hash = extensions.crypt(password_hash, extensions.gen_salt('bf', 10))
WHERE password_hash IS NOT NULL
  AND password_hash NOT LIKE '$2%';

-- Revoke SELECT on password_hash from anon and authenticated roles
REVOKE SELECT ON public.session_participants FROM anon, authenticated;

GRANT SELECT (id, session_id, email, role, display_name, presentation_order,
  dd_room_link, website_link, is_logged_in, logged_in_at, created_at)
ON public.session_participants TO anon, authenticated;

-- Tighten chat_messages INSERT: validate sender is a participant of the session
DROP POLICY IF EXISTS "Chat insertable by anon" ON public.chat_messages;
DROP POLICY IF EXISTS "Chat insertable by authenticated" ON public.chat_messages;

CREATE POLICY "Chat insertable by anon" ON public.chat_messages
FOR INSERT TO anon
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_participants.session_id = chat_messages.session_id
      AND session_participants.email = chat_messages.sender_email
  )
);

CREATE POLICY "Chat insertable by authenticated" ON public.chat_messages
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_participants.session_id = chat_messages.session_id
      AND session_participants.email = chat_messages.sender_email
  )
);

-- Make chat-archives bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-archives';

-- Tighten session_participants write policies
DROP POLICY IF EXISTS "Anon can update login status" ON public.session_participants;
DROP POLICY IF EXISTS "Participants updatable by all" ON public.session_participants;
DROP POLICY IF EXISTS "Participants deletable by all" ON public.session_participants;

CREATE POLICY "Participants can update login status" ON public.session_participants
FOR UPDATE TO public
USING (true)
WITH CHECK (true);
