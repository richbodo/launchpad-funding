
CREATE OR REPLACE FUNCTION public.enforce_gift_pledge_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.pledge_type = 'gift' AND NEW.amount > 100 THEN
    RAISE EXCEPTION 'Community gift pledges are capped at $100 (got %).', NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_gift_pledge_cap_trg ON public.investments;
CREATE TRIGGER enforce_gift_pledge_cap_trg
BEFORE INSERT OR UPDATE ON public.investments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_gift_pledge_cap();
