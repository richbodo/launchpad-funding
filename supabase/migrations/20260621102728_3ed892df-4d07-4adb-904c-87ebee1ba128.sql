CREATE OR REPLACE FUNCTION public.broadcast_investment_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'session_id', NEW.session_id,
      'startup_email', NEW.startup_email,
      'investor_email', NEW.investor_email,
      'amount', NEW.amount,
      'pledge_type', NEW.pledge_type,
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
$function$;