-- Indexes for hot paths
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON public.chat_messages (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_investments_session
  ON public.investments (session_id);

CREATE INDEX IF NOT EXISTS idx_session_participants_session_email
  ON public.session_participants (session_id, email);

CREATE INDEX IF NOT EXISTS idx_session_participants_session_role
  ON public.session_participants (session_id, role);

-- Broadcast trigger: chat_messages INSERT -> realtime channel "chat:{session_id}"
CREATE OR REPLACE FUNCTION public.broadcast_chat_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'session_id', NEW.session_id,
      'sender_email', NEW.sender_email,
      'sender_name', NEW.sender_name,
      'sender_role', NEW.sender_role,
      'message', NEW.message,
      'created_at', NEW.created_at
    ),
    'INSERT',
    'chat:' || NEW.session_id::text,
    false  -- public channel (no auth required)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block an insert because of broadcast failures
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_chat_message_insert ON public.chat_messages;
CREATE TRIGGER trg_broadcast_chat_message_insert
AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.broadcast_chat_message_insert();

-- Broadcast trigger: investments INSERT -> realtime channel "investments:{session_id}"
CREATE OR REPLACE FUNCTION public.broadcast_investment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'session_id', NEW.session_id,
      'startup_email', NEW.startup_email,
      'investor_email', NEW.investor_email,
      'amount', NEW.amount,
      'created_at', NEW.created_at
    ),
    'INSERT',
    'investments:' || NEW.session_id::text,
    false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_investment_insert ON public.investments;
CREATE TRIGGER trg_broadcast_investment_insert
AFTER INSERT ON public.investments
FOR EACH ROW EXECUTE FUNCTION public.broadcast_investment_insert();

-- These tables no longer need to be in the postgres_changes publication;
-- the client will switch to Broadcast subscriptions in a follow-up commit.
-- We keep them in the publication for now to avoid breaking any in-flight clients;
-- a separate migration after the frontend ships will remove them.