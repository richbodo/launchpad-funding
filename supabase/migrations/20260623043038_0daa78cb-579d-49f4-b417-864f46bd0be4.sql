-- Issue #30 scaling: replace postgres_changes participants subscription with a
-- targeted Realtime Broadcast. The trigger only fires when columns the UI
-- actually reads change, so high-frequency is_logged_in flips during login
-- (108 clients * many writes) no longer wake every client.

CREATE OR REPLACE FUNCTION public.broadcast_participant_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only react to startups; investors/facilitators aren't rendered in the
  -- startup list.
  IF NEW.role <> 'startup' THEN
    RETURN NEW;
  END IF;

  -- Only broadcast when a field the UI displays actually changed.
  IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name
     AND NEW.presentation_order IS NOT DISTINCT FROM OLD.presentation_order
     AND NEW.funding_goal IS NOT DISTINCT FROM OLD.funding_goal
     AND NEW.dd_room_link IS NOT DISTINCT FROM OLD.dd_room_link
     AND NEW.website_link IS NOT DISTINCT FROM OLD.website_link
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN
    RETURN NEW;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'email', NEW.email,
      'display_name', NEW.display_name,
      'presentation_order', NEW.presentation_order,
      'funding_goal', NEW.funding_goal,
      'dd_room_link', NEW.dd_room_link,
      'website_link', NEW.website_link,
      'description', NEW.description,
      'image_url', NEW.image_url
    ),
    'UPDATE',
    'participants:' || NEW.session_id::text,
    false
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block writes if broadcast fails.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS broadcast_participant_profile_update_trg ON public.session_participants;
CREATE TRIGGER broadcast_participant_profile_update_trg
AFTER UPDATE ON public.session_participants
FOR EACH ROW
EXECUTE FUNCTION public.broadcast_participant_profile_update();

-- Nice-to-have: ensure chat_messages and investments remain in the realtime
-- publication. They already are, but make this idempotent for future drift.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'investments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.investments;
  END IF;
END $$;